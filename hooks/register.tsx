// owner-inbox: one inbox for everything Claude Code sessions need from their
// owner. Sessions add items with a tool that returns at once; the items wait in
// a pane beside the chat until the owner handles them; the answer goes back to
// the session that asked, as a message. Every session on the machine reads and
// writes the same folder of small JSON files (see store.ts).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Delivery, Entry, Item, Phase, Receipt, Response, Sections, Snapshot, StepResult } from '../types'
import {
  type AddInput,
  ID_RE,
  LIMITS,
  TOOL_PREFIX,
  answerDelivery,
  buildEntries,
  chatCapture,
  counts,
  deliveryText,
  dueDeliveries,
  findSecret,
  isPending,
  makeItem,
  newId,
  parseAdd,
  projectName,
  statusOf,
  toolView,
} from './core'
import { type Strings, strings } from './i18n'
import { type FsLike, InboxStore } from './store'
import { type Actions, draftKey, phaseKey, renderPane } from './view'

const PANE = 'owner-inbox'
const COMMAND = 'owner-inbox'
// Done items kept in the pane's state; older ones stay on disk.
const DONE_KEPT = 30
// How long a wake the session did not take waits before the next try.
const RETRY_MS = 60_000
const PLUGIN = 'owner-inbox'

const snapshot = atom({ plugin: 'owner-inbox', key: 'snapshot' } as const, { entries: [] } as Snapshot, {
  shape: 'snapshot-1',
})
const selected = atom({ plugin: 'owner-inbox', key: 'selected' } as const, null as string | null)
const sections = atom({ plugin: 'owner-inbox', key: 'sections' } as const, {
  answered: false,
  done: false,
} as Sections)
const notice = atom({ plugin: 'owner-inbox', key: 'notice' } as const, null as string | null)

const GUIDE = `# Owner inbox
Anything you need from the owner goes into the owner inbox with ${TOOL_PREFIX}add: a question, a decision, an approval, something to look at, a task only they can do, or a test guide for them to run. Long autonomous work scrolls chat messages out of sight; the inbox keeps each item beside the chat until the owner handles it, and shows which session it came from. Add it the moment the need comes up, even while busy, and mention it in chat as usual. Adding returns at once and never waits for the owner: keep working on whatever does not depend on the answer. Put everything needed to answer into the item itself (context, your recommendation, links), since the owner may read it hours later. The owner may also mark an item as in progress or put it off for later; a short message tells you, and the item stays open. If you end a turn asking the owner something in chat without adding it, the inbox takes the question from your message itself; adding it yourself gives it a proper title, options and context. When the owner answers, a message from the owner-inbox plugin arrives in this session; ${TOOL_PREFIX}answers fetches answers on demand. Close items you have acted on or no longer need with ${TOOL_PREFIX}resolve. Never put secrets (keys, tokens, passwords) into the inbox.`

const STEP_SCHEMA = {
  anyOf: [
    { type: 'string' },
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to do.' },
        expect: { type: 'string', description: 'What should happen.' },
      },
      required: ['text'],
    },
  ],
}

const TOOLS = [
  {
    name: 'add',
    description:
      "Puts something you need from the owner into their inbox, where it stays beside the chat until they handle it. Returns at once with the item's id; keep working on what does not depend on it. The answer arrives later in this session as a message from the owner-inbox plugin. Never include secrets.",
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['question', 'decision', 'approval', 'review', 'task', 'test'],
          description:
            'question: they answer with an option and/or in words. decision: they pick one of several options. approval: they approve or reject something before you do it. review: something to look at (put links in body). task: something only they can do. test: a test guide they run step by step, marking each step as works or fails, with a note.',
        },
        title: { type: 'string', description: 'One short line: what you need.' },
        body: {
          type: 'string',
          description:
            'Markdown with everything needed to answer without the chat: context, your recommendation, links (https: or file:).',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'question and decision only: 2 to 8 answer buttons.',
        },
        recommended: { type: 'string', description: 'The option you recommend; one of options.' },
        allow_text: {
          type: 'boolean',
          description: 'question and decision with options: also offer a free-text answer (default true).',
        },
        steps: {
          type: 'array',
          items: STEP_SCHEMA,
          description: 'test only: the steps in order, each a string or { text, expect }.',
        },
        project: { type: 'string', description: 'Defaults to the repository or folder name.' },
        from: {
          type: 'string',
          description: 'A short name for this session the owner recognizes, such as "lead" or "docs".',
        },
      },
      required: ['type', 'title'],
    },
  },
  {
    name: 'answers',
    description:
      "Returns the owner's answers to items this session added that are not closed yet. Answers also arrive by themselves as a message; use this to check on demand.",
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['session', 'project'],
          description: 'session (default): items this session added. project: every session of this project.',
        },
      },
    },
  },
  {
    name: 'list',
    description: 'Lists inbox items with their status (open, answered, done) and answers.',
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'progress', 'later', 'answered', 'done', 'all'],
          description: 'Default: everything not done (open, progress, later, answered).',
        },
        scope: {
          type: 'string',
          enum: ['session', 'project', 'all'],
          description: 'Default: project.',
        },
      },
    },
  },
  {
    name: 'resolve',
    description:
      'Closes inbox items: done once you have acted on the answer, withdrawn when you no longer need it. Closed items leave the owner\'s list.',
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'The item ids.' },
        reason: { type: 'string', enum: ['done', 'withdrawn'], description: 'Default: done.' },
        note: { type: 'string', description: 'Optional, shown to the owner.' },
      },
      required: ['ids'],
    },
  },
] as const

type $ = EngineInterface

const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'])

function argsOf(e: object): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(e)) {
    if (!RESERVED.has(key)) args[key] = value
  }

  return args
}

function random(): number {
  try {
    const one = new Uint32Array(1)
    crypto.getRandomValues(one)

    return (one[0] ?? 0) / 0x100000000
  } catch {
    return Math.random()
  }
}

type Config = {
  s: Strings
  autoOpen: boolean
  notify: boolean
  captureChat: boolean
  pollMs: number
  dataDir: string
}

function systemLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

function configOf(options: Readonly<Record<string, unknown>>): Config {
  const pollSeconds = Number(options.pollSeconds)

  return {
    s: strings(options.language, systemLocale()),
    autoOpen: options.autoOpen !== false,
    notify: options.notify !== false,
    captureChat: options.captureChat !== false,
    pollMs:
      Number.isFinite(pollSeconds) && pollSeconds >= 1 && pollSeconds <= 60 ? pollSeconds * 1000 : 3000,
    dataDir: typeof options.dataDir === 'string' ? options.dataDir.trim() : '',
  }
}

/** What this load of the module knows. A reload starts it over, and
 * session.start runs again to fill it in. */
type Memory = {
  inbox: InboxStore | undefined
  /** This conversation's id; undefined from a /clear until the next poll. */
  sessionId: string | undefined
  root: string | undefined
  defaultProject: string
  known: Set<string> | undefined
  /** The store generation the pane last drew. */
  drawn: number
  busy: boolean
  again: boolean
  againWake: boolean
  lastTitle: string | undefined
  /** Items whose news is on its way to this session, by the version sent. */
  claimed: Map<string, number>
  retryAfter: Map<string, number>
  /** How many deliveries the last poll found due: a cheap gate for the hooks. */
  dueCount: number
  lastDrop: string | undefined
  /** The test whose send waits for a second press. */
  confirmSend: string | null
  /** Whether the running turn put anything into the inbox itself. */
  addedInTurn: boolean
  drafts: Map<string, string>
  docks: Map<string, boolean>
  /** The owner's pane changes, one after the other. */
  writes: Promise<void>
}

function freshMemory(): Memory {
  return {
    inbox: undefined,
    sessionId: undefined,
    root: undefined,
    defaultProject: 'unknown',
    known: undefined,
    drawn: -1,
    busy: false,
    again: false,
    againWake: false,
    lastTitle: undefined,
    claimed: new Map(),
    retryAfter: new Map(),
    dueCount: 0,
    lastDrop: undefined,
    confirmSend: null,
    addedInTurn: false,
    drafts: new Map(),
    docks: new Map(),
    writes: Promise.resolve(),
  }
}

let config: Config = configOf({})
let mem: Memory = freshMemory()

/** The part of `$.fs` the store needs. */
function fsOf($: $): FsLike {
  return {
    read: path => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    list: path => $.fs.list(path),
  }
}

async function store($: $): Promise<InboxStore> {
  if (mem.inbox !== undefined) return mem.inbox
  const home =
    (await $.env.get('USERPROFILE')) ??
    (await $.env.get('HOME')) ??
    `${(await $.env.get('HOMEDRIVE')) ?? ''}${(await $.env.get('HOMEPATH')) ?? ''}`
  const dir =
    config.dataDir === ''
      ? `${home}/.owner-inbox`
      : config.dataDir.startsWith('~')
        ? `${home}${config.dataDir.slice(1)}`
        : config.dataDir
  mem.inbox = new InboxStore(fsOf($), dir)

  return mem.inbox
}

async function currentSession($: $): Promise<string> {
  const id = await $.session.id()
  mem.sessionId = id

  return id
}

async function openPane($: $, open: number): Promise<void> {
  mem.lastTitle = config.s.paneTitle(open)
  await $.ui.open({ id: PANE, title: mem.lastTitle })
}

/** Opens the pane unasked only where it docks beside the chat. */
async function maybeOpen($: $, open: number): Promise<void> {
  if (!config.autoOpen) return
  const surfaces = await $.session.surfaces()
  const docking = surfaces.some(surface => {
    const seen = mem.docks.get(surface)

    return seen ?? (surface === 'desktop' || surface === 'vscode')
  })
  if (docking) await openPane($, open)
}

async function retitle($: $, open: number): Promise<void> {
  if (config.s.paneTitle(open) === mem.lastTitle) return
  const panes = await $.ui.panes()
  if (!panes.some(pane => pane.id === PANE)) return
  await openPane($, open)
}

// ---- Bringing the owner's answers to the session that asked -----------------
//
// Three carriers, one claim: a delivery is claimed (synchronously, before any
// await) by the carrier that takes it, released when the carrier failed, and
// committed, with a receipt on disk, only once it reached the model.
//   1. wake: a message of its own, sent from the poll timer alone (the host
//      refuses one from inside a tool or command hook);
//   2. the next tool result the model itself asked for;
//   3. the next prompt.

function claim(deliveries: readonly Delivery[]): void {
  for (const delivery of deliveries) mem.claimed.set(delivery.entry.item.id, delivery.version)
}

function release(deliveries: readonly Delivery[]): void {
  for (const delivery of deliveries) {
    const id = delivery.entry.item.id
    if (mem.claimed.get(id) === delivery.version) mem.claimed.delete(id)
  }
}

async function writeReceipts($: $, deliveries: readonly Delivery[]): Promise<void> {
  const inbox = await store($)
  const at = await $.clock.now()
  for (const delivery of deliveries) {
    await inbox.writeReceipt({ v: 1, id: delivery.entry.item.id, deliveredAt: at, answeredAt: delivery.version })
  }
}

/** Records that the deliveries reached the model; never throws. */
async function commit($: $, deliveries: readonly Delivery[]): Promise<void> {
  try {
    await writeReceipts($, deliveries)
  } catch {
    // The model has the answer; a missing receipt only means it may get it again.
  } finally {
    release(deliveries)
  }
  await refresh($).catch(() => undefined)
}

/** This session's deliveries that are due and not on their way, from what the store holds. */
function unclaimedDue(): Delivery[] {
  const inbox = mem.inbox
  if (inbox === undefined || mem.sessionId === undefined) return []
  const { items, responses, receipts, seen } = inbox.contents()

  return dueDeliveries(buildEntries(items, responses, seen, receipts), receipts, mem.sessionId).filter(
    delivery => !mem.claimed.has(delivery.entry.item.id),
  )
}

/**
 * Takes what is due for whatever the model reads next (a tool result, a
 * prompt); the caller commits or releases it. Undefined when nothing is.
 */
function handOver(): Delivery[] | undefined {
  if (mem.dueCount === 0) return undefined
  const due = unclaimedDue()
  if (due.length === 0) return undefined
  claim(due)

  return due
}

/**
 * Wakes the session with a message. The call resolves when the message starts
 * a turn (at once while the session is idle, after the running turn
 * otherwise), or with `drop` when it did not enter; only the first counts.
 * A dropped delivery goes along with the next tool result or prompt.
 */
async function wakeDue($: $): Promise<void> {
  const now = await $.clock.now()
  const ready = unclaimedDue().filter(delivery => (mem.retryAfter.get(delivery.entry.item.id) ?? 0) <= now)
  if (ready.length === 0) return
  claim(ready)
  const heldBack = async (reason: string) => {
    release(ready)
    const at = await $.clock.now().catch(() => now)
    for (const delivery of ready) mem.retryAfter.set(delivery.entry.item.id, at + RETRY_MS)
    if (reason !== mem.lastDrop) {
      mem.lastDrop = reason
      $.ui.log(
        `owner-inbox: could not wake this session with the owner's answer (${reason}); it goes along with the next tool result or prompt.`,
      )
    }
  }
  void $.prompt
    .submit({ text: deliveryText(ready) })
    .then(entered => (entered.drop === undefined ? commit($, ready) : heldBack(entered.drop || 'dropped')))
    .catch((error: unknown) => heldBack(error instanceof Error ? error.message : 'refused'))
}

async function refreshOnce($: $, mayWake: boolean): Promise<void> {
  const inbox = await store($)
  await inbox.scan()
  const { items, responses, receipts, seen } = inbox.contents()
  const entries = buildEntries(items, responses, seen, receipts)
  mem.dueCount = dueDeliveries(entries, receipts, mem.sessionId).length
  if (inbox.generation !== mem.drawn) {
    mem.drawn = inbox.generation
    const kept = [
      ...entries.filter(entry => entry.status !== 'done'),
      ...entries.filter(entry => entry.status === 'done').slice(0, DONE_KEPT),
    ]
    await update($, snapshot, () => ({ entries: kept }))

    const before = mem.known
    const arrived =
      before === undefined
        ? []
        : entries.filter(entry => entry.status === 'open' && entry.isNew && !before.has(entry.item.id))
    mem.known = new Set(entries.filter(entry => entry.status === 'open').map(entry => entry.item.id))
    const { open } = counts(entries)
    await retitle($, open)
    if ((before === undefined && open > 0) || arrived.length > 0) await maybeOpen($, open)
    const first = arrived[0]
    if (arrived.length === 1 && first !== undefined) {
      $.ui.toast(`${config.s.notifyTitle}: ${first.item.title}`)
    } else if (arrived.length > 1) {
      $.ui.toast(`${config.s.notifyTitle}: ${arrived.length}`)
    }
  }
  if (mayWake && mem.dueCount > 0) await wakeDue($)
}

/**
 * Re-reads the folder; calls that come in while one runs fold into one more.
 * Only the poll timer may wake the session.
 */
async function refresh($: $, mayWake = false): Promise<void> {
  if (mem.busy) {
    mem.again = true
    mem.againWake = mem.againWake || mayWake

    return
  }
  mem.busy = true
  try {
    let wake = mayWake
    do {
      mem.again = false
      await refreshOnce($, wake)
      wake = mem.againWake
      mem.againWake = false
    } while (mem.again)
  } finally {
    mem.busy = false
  }
}

async function poll($: $): Promise<void> {
  await currentSession($)
  await refresh($, true)
}

// ---- The owner's actions in the pane ----------------------------------------

/** Runs the owner's changes one after the other, so none reads what another is still writing. */
function serial(work: () => Promise<void>): Promise<void> {
  const run = mem.writes.then(work).catch(() => undefined)
  mem.writes = run

  return run
}

async function say($: $, text: string | null): Promise<void> {
  await update($, notice, () => text)
}

/** False, with a warning shown, when any of the owner's texts looks like a secret. */
async function checked($: $, texts: readonly (string | undefined)[]): Promise<boolean> {
  for (const text of texts) {
    if (text !== undefined && findSecret(text) !== undefined) {
      await say($, config.s.secretWarning)

      return false
    }
  }

  return true
}

function trimmed(text: string | undefined): string | undefined {
  const value = text?.trim().slice(0, LIMITS.answer)

  return value === undefined || value === '' ? undefined : value
}

async function answer(
  $: $,
  id: string,
  patch: Partial<Pick<Response, 'choice' | 'text' | 'steps'>>,
): Promise<void> {
  const inbox = await store($)
  const item = inbox.item(id)
  const response = await inbox.readResponse(id)
  if (item === undefined || !isPending(statusOf(item, response))) return
  const now = await $.clock.now()
  const steps = patch.steps ?? response?.steps
  // A receipt names what it delivered by this time, so a changed answer must
  // never carry the time of what went before it.
  const delivered = inbox.receipt(id)?.answeredAt ?? 0
  await inbox.writeResponse({
    v: 1,
    id,
    status: 'answered',
    ...(patch.choice === undefined ? {} : { choice: patch.choice }),
    ...(patch.text === undefined ? {} : { text: patch.text }),
    ...(steps === undefined ? {} : { steps }),
    updatedAt: now,
    answeredAt: Math.max(now, delivered + 1),
  })
  for (const key of [...mem.drafts.keys()]) {
    if (key === id || key.startsWith(`${id}:`)) mem.drafts.delete(key)
  }
  await inbox.markSeen([id], now)
  await say($, null)
  await update($, selected, () => null)
  await refresh($)
}

async function saveSteps(
  $: $,
  id: string,
  change: (steps: Record<string, StepResult>) => Record<string, StepResult>,
): Promise<void> {
  const inbox = await store($)
  const item = inbox.item(id)
  const response = await inbox.readResponse(id)
  if (item === undefined || !isPending(statusOf(item, response))) return
  await inbox.writeResponse({
    ...(response ?? { v: 1, id, status: 'draft' }),
    steps: change({ ...(response?.steps ?? {}) }),
    updatedAt: await $.clock.now(),
  })
  await refresh($)
}

async function selectItem($: $, id: string | null): Promise<void> {
  mem.confirmSend = null
  await say($, null)
  await update($, selected, () => id)
  if (id === null || !ID_RE.test(id)) return
  await (await store($)).markSeen([id], await $.clock.now())
  await refresh($)
}

async function chooseOption($: $, id: string, choice: string): Promise<void> {
  const text = trimmed(mem.drafts.get(draftKey(id)))
  if (!(await checked($, [text]))) return
  await answer($, id, { choice, ...(text === undefined ? {} : { text }) })
}

async function sendText($: $, id: string, typed: string): Promise<void> {
  const text = trimmed(typed) ?? trimmed(mem.drafts.get(draftKey(id)))
  if (text === undefined) {
    await say($, config.s.needAnswer)

    return
  }
  if (!(await checked($, [text]))) return
  await answer($, id, { text })
}

function withNote(step: StepResult | undefined, note: string | undefined): StepResult {
  const { note: _old, ...rest } = step ?? {}

  return note === undefined ? rest : { ...rest, note }
}

async function saveStepNote($: $, id: string, stepId: string, typed: string): Promise<void> {
  const note = trimmed(typed)
  if (!(await checked($, [note]))) return
  mem.drafts.delete(draftKey(id, stepId))
  await saveSteps($, id, steps => ({ ...steps, [stepId]: withNote(steps[stepId], note) }))
}

async function markStep($: $, id: string, stepId: string, result: 'pass' | 'fail'): Promise<void> {
  if (mem.confirmSend === id) {
    mem.confirmSend = null
    await say($, null)
  }
  await saveSteps($, id, steps => ({ ...steps, [stepId]: { ...steps[stepId], result } }))
}

async function sendTest($: $, id: string): Promise<void> {
  const inbox = await store($)
  const item = inbox.item(id)
  if (item === undefined) return
  const steps: Record<string, StepResult> = { ...((await inbox.readResponse(id))?.steps ?? {}) }
  for (const step of item.steps ?? []) {
    const typed = mem.drafts.get(draftKey(id, step.id))
    if (typed !== undefined) steps[step.id] = withNote(steps[step.id], trimmed(typed))
  }
  if (!Object.values(steps).some(step => step.result !== undefined)) {
    await say($, config.s.needMark)

    return
  }
  // Steps without a result are sent only on a second press, so a note typed
  // in place of a mark does not pass for a finished test unnoticed.
  const unmarked = (item.steps ?? [])
    .filter(step => steps[step.id]?.result === undefined)
    .map(step => step.id)
  if (unmarked.length > 0 && mem.confirmSend !== id) {
    mem.confirmSend = id
    await say($, config.s.unmarked(unmarked))

    return
  }
  mem.confirmSend = null
  const text = trimmed(mem.drafts.get(draftKey(id)))
  if (!(await checked($, [text, ...Object.values(steps).map(step => step.note)]))) return
  await answer($, id, { steps, ...(text === undefined ? {} : { text }) })
}

async function undoAnswer($: $, id: string): Promise<void> {
  const inbox = await store($)
  const item = inbox.item(id)
  const response = await inbox.readResponse(id)
  if (item === undefined || response === undefined || item.closed !== undefined) return
  const now = await $.clock.now()
  const { answeredAt: _at, archived: _archived, archivedAt: _archivedAt, ...rest } = response
  await inbox.writeResponse({ ...rest, status: 'draft', retractedAt: now, updatedAt: now })
  await refresh($)
}

async function archiveItem($: $, id: string): Promise<void> {
  const inbox = await store($)
  const item = inbox.item(id)
  if (item === undefined || item.closed !== undefined) return
  const now = await $.clock.now()
  const response: Response = (await inbox.readResponse(id)) ?? { v: 1, id, status: 'draft', updatedAt: now }
  await inbox.writeResponse({ ...response, archived: true, archivedAt: now, updatedAt: now })
  await inbox.markSeen([id], now)
  await update($, selected, () => null)
  await refresh($)
}

/** Files an item as in progress or later with the drafted note, or back to active. */
async function setPhase($: $, id: string, phase: Phase | null): Promise<void> {
  const inbox = await store($)
  const item = inbox.item(id)
  const response = await inbox.readResponse(id)
  if (item === undefined || !isPending(statusOf(item, response))) return
  const note = trimmed(mem.drafts.get(phaseKey(id)))
  if (!(await checked($, [note]))) return
  const now = await $.clock.now()
  const base: Response = response ?? { v: 1, id, status: 'draft', updatedAt: now }
  const { phase: _phase, phaseNote: _note, ...rest } = base
  // Like an answer, each move needs a time no receipt names yet.
  const delivered = inbox.receipt(id)?.answeredAt ?? 0
  await inbox.writeResponse(
    phase === null
      ? { ...rest, updatedAt: now }
      : {
          ...rest,
          phase,
          phaseAt: Math.max(now, delivered + 1),
          ...(note === undefined ? {} : { phaseNote: note }),
          updatedAt: now,
        },
  )
  mem.drafts.delete(phaseKey(id))
  await inbox.markSeen([id], now)
  await say($, null)
  await update($, selected, () => null)
  await refresh($)
}

function actions($: $): Actions {
  return {
    select: id => void serial(() => selectItem($, id)),
    toggle: section => void update($, sections, old => ({ ...old, [section]: !old[section] })),
    choose: (id, choice) => void serial(() => chooseOption($, id, choice)),
    sendText: (id, text) => void serial(() => sendText($, id, text)),
    draft: (key, text) => {
      mem.drafts.set(key, text)
    },
    draftOf: key => mem.drafts.get(key),
    mark: (id, stepId, result) => void serial(() => markStep($, id, stepId, result)),
    saveStepNote: (id, stepId, text) => void serial(() => saveStepNote($, id, stepId, text)),
    sendTest: id => void serial(() => sendTest($, id)),
    undo: id => void serial(() => undoAnswer($, id)),
    archive: id => void serial(() => archiveItem($, id)),
    setPhase: (id, phase) => void serial(() => setPhase($, id, phase)),
  }
}

// ---- What sessions call -----------------------------------------------------

async function startSession($: $): Promise<void> {
  await currentSession($)
  mem.root = await $.session.root()
  const repo = await $.session.repo().catch(() => null)
  mem.defaultProject = projectName(mem.root, repo?.name)
  for (const spec of TOOLS) await $.tool.register(spec)
  await $.command.register({ name: COMMAND, description: config.s.commandDescription })
  await refresh($)
  $.clock.every(config.pollMs, () => {
    void poll($).catch(() => undefined)
  })
}

/** Writes a new item of this session's and tells the owner. */
async function putItem($: $, input: AddInput, captured: boolean): Promise<Item> {
  const inbox = await store($)
  const now = await $.clock.now()
  const made = makeItem(input, {
    id: newId(now, random),
    now,
    sessionId: await currentSession($),
    ...(mem.root === undefined ? {} : { root: mem.root }),
    defaultProject: mem.defaultProject,
  })
  const item: Item = captured ? { ...made, captured: true } : made
  await inbox.writeItem(item)
  if (config.notify) {
    void $.ui
      .notify(`${config.s.type[item.type]}: ${item.title}`, { title: config.s.notifyTitle, key: item.id })
      .catch(() => undefined)
  }
  await refresh($).catch(() => undefined)

  return item
}

async function addItem($: $, raw: Record<string, unknown>): Promise<string> {
  const parsed = parseAdd(raw)
  if (!parsed.ok) throw new InboxError(parsed.error)
  mem.addedInTurn = true
  const item = await putItem($, parsed.value, false)

  return `Added to the owner inbox as ${item.id} (${item.type}, project ${item.project}). It stays beside the chat until the owner handles it. Keep working on what does not depend on it; the answer will arrive here as a message from the owner-inbox plugin.`
}

class InboxError extends Error {}

// ---- The safety net: questions asked in chat alone -------------------------
//
// A session told to use the inbox still asks in chat now and then. When a turn
// ends with a message that asks the owner something and the turn put nothing
// into the inbox, the inbox takes the question itself. If the owner answers
// in the chat instead, the next prompt they type closes it again.

async function captureChat($: $, message: string): Promise<void> {
  if (!config.captureChat || mem.addedInTurn) return
  // Nobody to ask where nothing draws (a script's `claude -p`).
  if ((await $.session.surfaces()).length === 0) return
  const input = chatCapture(message)
  if (input !== undefined) await putItem($, input, true)
}

async function closeCaptured($: $): Promise<void> {
  const inbox = mem.inbox
  const sessionId = mem.sessionId
  if (inbox === undefined || sessionId === undefined) return
  const { items, responses } = inbox.contents()
  const waiting = items.filter(
    item =>
      item.captured === true &&
      item.source.sessionId === sessionId &&
      statusOf(item, responses.get(item.id)) === 'open',
  )
  if (waiting.length === 0) return
  const now = await $.clock.now()
  for (const item of waiting) {
    const fresh = await inbox.readItem(item.id)
    if (fresh === undefined || fresh.closed !== undefined) continue
    await inbox.writeItem({ ...fresh, closed: { at: now, reason: 'chat', by: sessionId } })
  }
  await refresh($).catch(() => undefined)
}

function inScope(entry: Entry, scope: unknown): boolean {
  if (scope === 'all') return true
  if (scope === 'session') return entry.item.source.sessionId === mem.sessionId

  return entry.item.project === mem.defaultProject
}

async function entriesNow($: $): Promise<{ entries: Entry[]; receipts: ReadonlyMap<string, Receipt> }> {
  const inbox = await store($)
  await inbox.scan()
  const { items, responses, receipts, seen } = inbox.contents()

  return { entries: buildEntries(items, responses, seen, receipts), receipts }
}

async function answersFor($: $, raw: Record<string, unknown>): Promise<string> {
  const sessionId = await currentSession($)
  const { entries, receipts } = await entriesNow($)
  const scope = raw.scope === 'project' ? 'project' : 'session'
  // Everything this session has yet to hear (answers, put-away, taken-back),
  // then the answers of other sessions in scope, which stay theirs to receive.
  const own = dueDeliveries(entries, receipts, sessionId)
  const ownIds = new Set(own.map(delivery => delivery.entry.item.id))
  const others = entries
    .filter(entry => entry.status === 'answered' && !ownIds.has(entry.item.id) && inScope(entry, scope))
    .map(answerDelivery)
    .filter((delivery): delivery is Delivery => delivery !== undefined)
  const shown = [...own, ...others]
  if (shown.length === 0) {
    const waiting = entries.filter(entry => entry.status === 'open' && inScope(entry, scope))

    return waiting.length === 0
      ? 'No answers and nothing waiting.'
      : `No answers yet; ${waiting.length} item(s) still open: ${waiting.map(entry => entry.item.id).join(', ')}.`
  }
  if (own.length > 0) await commit($, own)

  return deliveryText(shown)
}

async function listFor($: $, raw: Record<string, unknown>): Promise<string> {
  await currentSession($)
  const status = raw.status
  const shown = (await entriesNow($)).entries
    .filter(entry => inScope(entry, raw.scope ?? 'project'))
    .filter(entry =>
      status === 'all' ? true : status === undefined ? entry.status !== 'done' : entry.status === status,
    )
    .slice(0, 50)

  return shown.length === 0 ? 'No items.' : JSON.stringify(shown.map(toolView), null, 1)
}

async function resolveItems($: $, raw: Record<string, unknown>): Promise<string> {
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((id): id is string => typeof id === 'string') : []
  if (ids.length === 0) throw new InboxError('ids is required.')
  const reason = raw.reason === 'withdrawn' ? 'withdrawn' : 'done'
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 2000) : ''
  if (note !== '' && findSecret(note) !== undefined) {
    throw new InboxError('the note looks like it holds a secret.')
  }
  const sessionId = await currentSession($)
  const inbox = await store($)
  const now = await $.clock.now()
  const lines: string[] = []
  for (const id of ids) {
    if (!ID_RE.test(id)) {
      lines.push(`${id}: not an inbox id.`)
      continue
    }
    const item = await inbox.readItem(id)
    if (item === undefined) {
      lines.push(`${id}: not found.`)
      continue
    }
    if (item.closed !== undefined) {
      lines.push(`${id}: already closed.`)
      continue
    }
    await inbox.writeItem({
      ...item,
      closed: { at: now, reason, by: sessionId, ...(note === '' ? {} : { note }) },
    })
    lines.push(`${id}: closed (${reason}).`)
  }
  await refresh($).catch(() => undefined)

  return lines.join('\n')
}

/** A tool's answer: its text, or the refusal the model reads as an error. */
async function answerTool(work: Promise<string>): Promise<{ result: string } | { deny: string }> {
  try {
    return { result: await work }
  } catch (error) {
    const message = error instanceof InboxError ? error.message : 'the inbox could not be read or written.'

    return { deny: `owner-inbox: ${message}` }
  }
}

// ---- Only the owner writes answers ------------------------------------------

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

const comparable = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * Whether a tool call would write into the inbox folder by hand. Answers are
 * plain files, so a model could otherwise write itself an owner's approval.
 * File tools are judged by their path; shell commands by naming the folder,
 * which is a best effort, not a boundary.
 */
async function touchesInbox($: $, e: Record<string, unknown>): Promise<boolean> {
  try {
    return isInboxWrite(String(e.tool), e, comparable((await store($)).dir))
  } catch {
    // A guard that cannot tell lets the call through: it must never stop all work.
    return false
  }
}

function isInboxWrite(tool: string, e: Record<string, unknown>, dir: string): boolean {
  if (FILE_TOOLS.has(tool)) {
    const target = e.file_path ?? e.notebook_path
    if (typeof target !== 'string') return false
    const path = comparable(target)

    return path === dir || path.startsWith(`${dir}/`) || path.includes('/.owner-inbox/')
  }
  if (SHELL_TOOLS.has(tool) && typeof e.command === 'string') {
    const command = comparable(e.command)

    return command.includes('.owner-inbox') || command.includes(dir)
  }

  return false
}

async function paneModel($: $) {
  return {
    entries: (await read($, snapshot)).entries,
    selected: await read($, selected),
    sections: await read($, sections),
    notice: await read($, notice),
    now: await $.clock.now(),
    confirming: mem.confirmSend,
  }
}

async function openCount($: $): Promise<number> {
  return counts((await read($, snapshot)).entries).open
}

export const register: Register = (on, options) => {
  config = configOf(options)
  mem = freshMemory()

  on('session.start', async ($, e, next) => {
    try {
      await startSession($)
    } catch {
      // The inbox is a helper: a failure here never holds the session up.
    }

    return next(e)
  })

  // A /clear starts a new conversation in the same process, with no
  // session.start: nothing is delivered until the next poll reads its id.
  on('session.end', ($, e, next) => {
    mem.sessionId = undefined

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await refresh($).catch(() => undefined)
    await openPane($, await openCount($))

    return { text: config.s.commandOpened }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes(`${TOOL_PREFIX}add`)) return composed

    return {
      sections: [...composed.sections, { id: 'owner-inbox:guide', text: GUIDE, scope: 'session' as const }],
    }
  })

  on('tool.call', async ($, e, next) => {
    if (await touchesInbox($, e as Record<string, unknown>)) {
      return {
        deny: `owner-inbox: the inbox folder is written only by the ${TOOL_PREFIX}* tools and the owner's own pane, so nobody can answer in the owner's place.`,
      }
    }
    const ran = await next(e)
    // Only a call the model made itself reads a reminder after its result.
    if (next.origin.plugin !== 'engine' || e.agentId !== undefined || ran.deny !== undefined) return ran
    const due = handOver()
    if (due === undefined) return ran
    await commit($, due)

    return { ...ran, context: [...(ran.context ?? []), deliveryText(due)] }
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    // Absent on the person's own prompt, whatever the types say.
    const origin = e.origin as { kind: string; name?: string } | undefined
    const isOwn = origin?.kind === 'plugin' && origin.name === PLUGIN
    if (isOwn || e.command !== undefined) return next(e)
    // The owner writes in the chat: what was taken from it is answered there.
    if (origin === undefined || origin.kind === 'human' || origin.kind === 'composer') {
      await closeCaptured($).catch(() => undefined)
    }
    const due = handOver()
    if (due === undefined) return next(e)
    const entered = await next({ ...e, context: [...(e.context ?? []), deliveryText(due)] })
    if (entered.drop === undefined) await commit($, due)
    else release(due)

    return entered
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) mem.addedInTurn = false

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason === 'answer' && !e.isAborted) {
      await captureChat($, e.answer).catch(() => undefined)
    }

    return done
  })

  on('tool.call', { tool: 'mcp__owner-inbox__add' }, ($, e) => answerTool(addItem($, argsOf(e))))
  on('tool.call', { tool: 'mcp__owner-inbox__answers' }, ($, e) => answerTool(answersFor($, argsOf(e))))
  on('tool.call', { tool: 'mcp__owner-inbox__list' }, ($, e) => answerTool(listFor($, argsOf(e))))
  on('tool.call', { tool: 'mcp__owner-inbox__resolve' }, ($, e) => answerTool(resolveItems($, argsOf(e))))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.viewport?.isFullscreen !== undefined) mem.docks.set(e.surface, e.viewport.isFullscreen)
    const { entries } = await read($, snapshot)
    const { open, fresh, progress, later } = counts(entries)
    if (open + progress + later === 0 || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    // What is put off stays in sight at the right edge, apart from what waits.
    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Button
          key="open-inbox"
          plain
          label={config.s.band(open, fresh, progress)}
          onPress={() => void openPane($, open)}
        />
        {later > 0 && (
          <Button key="open-later" plain onPress={() => void openPane($, open)}>
            <Text color="suggestion">{config.s.bandLater(later)}</Text>
          </Button>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.viewport?.isFullscreen !== undefined) mem.docks.set(e.surface, e.viewport.isFullscreen)

    return renderPane($.ui.resolve(e), await paneModel($), actions($), config.s)
  })
}
