// Pure logic of the owner inbox: parsing what a session adds, deriving each
// item's status, the secret guard, and the texts the model reads. Nothing here
// touches the engine, so the tests drive it directly.
import type {
  Delivery,
  Entry,
  Item,
  ItemType,
  Receipt,
  Response,
  Status,
  Step,
  StepResult,
} from '../types'

export const ITEM_TYPES: readonly ItemType[] = [
  'question',
  'decision',
  'approval',
  'review',
  'task',
  'test',
]

export const LIMITS = {
  title: 200,
  body: 20000,
  option: 200,
  options: 8,
  steps: 50,
  step: 2000,
  label: 80,
  project: 80,
  answer: 10000,
} as const

/** The id every file name is built from; anything else is refused. */
export const ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/

const SECRET_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['an API key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['an AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['a Tailscale key', /\btskey-[A-Za-z0-9-]{10,}/],
  ['a JSON web token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  // A name like PASSWORD, DB_PASSWORD or AWS_SECRET_ACCESS_KEY given a value
  // that holds a digit or a symbol, as keys and passwords do and code does not
  // (`token = process.env.TOKEN` passes).
  [
    'a secret value',
    /(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|private[_-]?key|secret|token|passwor[dt]|passwd|pwd)(?:[_-][A-Za-z0-9]+)*["']?\s*[:=]\s*["']?(?=[^\s"']*[0-9!@#$%^&*+/=?~])[^\s"'()[\]{}<>,;]{8,}/i,
  ],
]

/** Names the kind of secret `text` seems to hold, or undefined. */
export function findSecret(text: string): string | undefined {
  for (const [name, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) return name
  }

  return undefined
}

// Control characters other than tab and newline break titles and lines.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

function clean(text: string): string {
  return text.replace(CONTROL, '').trim()
}

function oneLine(text: string): string {
  return clean(text).replace(/\s+/g, ' ')
}

export type AddInput = {
  type: ItemType
  title: string
  body?: string
  options?: string[]
  recommended?: string
  allowText: boolean
  steps?: Step[]
  project?: string
  label?: string
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

function optionalText(
  raw: unknown,
  name: string,
  max: number,
  single: boolean,
): Parsed<string | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (typeof raw !== 'string') return fail(`${name} must be a string.`)
  const text = single ? oneLine(raw) : clean(raw)
  if (text.length > max) return fail(`${name} is longer than ${max} characters.`)

  return { ok: true, value: text === '' ? undefined : text }
}

/**
 * Checks what a session passes to the add tool. Errors name the field, so the
 * model can fix the call at once.
 */
export function parseAdd(raw: Record<string, unknown>): Parsed<AddInput> {
  const type = raw.type
  if (typeof type !== 'string' || !ITEM_TYPES.includes(type as ItemType)) {
    return fail(`type must be one of: ${ITEM_TYPES.join(', ')}.`)
  }
  const kind = type as ItemType

  if (typeof raw.title !== 'string' || oneLine(raw.title) === '') {
    return fail('title is required.')
  }
  let title = oneLine(raw.title)
  if (title.length > LIMITS.title) title = `${title.slice(0, LIMITS.title - 1)}…`

  const body = optionalText(raw.body, 'body', LIMITS.body, false)
  if (!body.ok) return body
  const project = optionalText(raw.project, 'project', LIMITS.project, true)
  if (!project.ok) return project
  const label = optionalText(raw.from, 'from', LIMITS.label, true)
  if (!label.ok) return label

  let options: string[] | undefined
  if (raw.options !== undefined && raw.options !== null) {
    if (kind !== 'question' && kind !== 'decision') {
      return fail('options are only for question and decision; the other types have fixed buttons.')
    }
    if (!Array.isArray(raw.options)) return fail('options must be a list of strings.')
    const seen = new Set<string>()
    options = []
    for (const one of raw.options) {
      if (typeof one !== 'string') return fail('options must be a list of strings.')
      const text = oneLine(one)
      if (text === '') continue
      if (text.length > LIMITS.option) return fail(`an option is longer than ${LIMITS.option} characters.`)
      if (seen.has(text.toLowerCase())) continue
      seen.add(text.toLowerCase())
      options.push(text)
    }
    if (options.length > LIMITS.options) return fail(`at most ${LIMITS.options} options.`)
    if (options.length === 0) options = undefined
  }
  if (kind === 'decision' && (options === undefined || options.length < 2)) {
    return fail('a decision needs at least two options.')
  }
  if (options !== undefined && options.length === 1) {
    return fail('give at least two options, or none and let the owner answer in words.')
  }

  let recommended: string | undefined
  if (raw.recommended !== undefined && raw.recommended !== null) {
    if (typeof raw.recommended !== 'string') return fail('recommended must be a string.')
    const wanted = oneLine(raw.recommended).toLowerCase()
    recommended = options?.find(one => one.toLowerCase() === wanted)
    if (recommended === undefined) return fail('recommended must be one of the options.')
  }

  if (raw.allow_text !== undefined && typeof raw.allow_text !== 'boolean') {
    return fail('allow_text must be true or false.')
  }
  const allowText = options === undefined ? true : raw.allow_text !== false

  let steps: Step[] | undefined
  if (raw.steps !== undefined && raw.steps !== null) {
    if (kind !== 'test') return fail('steps are only for type test.')
    if (!Array.isArray(raw.steps)) return fail('steps must be a list.')
    steps = []
    for (const one of raw.steps) {
      const step = typeof one === 'string' ? { text: one } : one
      if (typeof step !== 'object' || step === null) {
        return fail('each step is a string or { text, expect }.')
      }
      const record = step as Record<string, unknown>
      const text = optionalText(record.text, 'a step', LIMITS.step, false)
      if (!text.ok) return text
      if (text.value === undefined) return fail('a step has no text.')
      const expect = optionalText(record.expect, "a step's expect", LIMITS.step, false)
      if (!expect.ok) return expect
      steps.push({
        id: String(steps.length + 1),
        text: text.value,
        ...(expect.value === undefined ? {} : { expect: expect.value }),
      })
    }
    if (steps.length > LIMITS.steps) return fail(`at most ${LIMITS.steps} steps.`)
  }
  if (kind === 'test' && (steps === undefined || steps.length === 0)) {
    return fail('a test needs steps.')
  }

  const everything = [
    title,
    body.value,
    project.value,
    label.value,
    ...(options ?? []),
    ...(steps ?? []).flatMap(step => [step.text, step.expect]),
  ]
  for (const text of everything) {
    const secret = text === undefined ? undefined : findSecret(text)
    if (secret !== undefined) {
      return fail(
        `this looks like it holds ${secret}. Never put secrets into the inbox; describe where the owner finds it instead.`,
      )
    }
  }

  return {
    ok: true,
    value: {
      type: kind,
      title,
      allowText,
      ...(body.value === undefined ? {} : { body: body.value }),
      ...(options === undefined ? {} : { options }),
      ...(recommended === undefined ? {} : { recommended }),
      ...(steps === undefined ? {} : { steps }),
      ...(project.value === undefined ? {} : { project: project.value }),
      ...(label.value === undefined ? {} : { label: label.value }),
    },
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// How many of a message's last blocks are searched for a question: one asked
// of the owner closes a message; one further up is mostly rhetorical.
const TAIL_BLOCKS = 3

/**
 * The questions in the closing blocks of a chat message, block by block: prose
 * sentences ending in a question mark, leaving out code, quotes, links and
 * headings, where question marks ask nothing of anyone.
 */
export function chatQuestions(message: string): string[][] {
  const prose = message
    .replace(/```[\s\S]*?```/g, '\n\n')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
  const blocks = prose
    .split(/\n\s*\n/)
    .map(block =>
      block
        .split('\n')
        .filter(line => !/^\s*(?:>|#|\*\*[^*]+\*\*:?\s*$)/.test(line))
        .join('\n'),
    )
    .filter(block => block.trim() !== '')
  const groups: string[][] = []
  for (const block of blocks.slice(-TAIL_BLOCKS)) {
    const found: string[] = []
    for (const line of block.split('\n')) {
      for (const raw of line.split(/(?<=[.!?。！？])\s+/)) {
        const sentence = oneLine(
          raw.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '').replace(/[*_~]+/g, ''),
        )
        if (sentence.length >= 8 && /[?？]["'»”」)\]]*$/.test(sentence)) found.push(sentence)
      }
    }
    if (found.length > 0) groups.push(found)
  }

  return groups
}

/**
 * The item a chat message that asks the owner something becomes; undefined
 * when it asks nothing, or holds what looks like a secret.
 */
export function chatCapture(message: string): AddInput | undefined {
  const groups = chatQuestions(message)
  const last = groups.at(-1)
  const first = last?.[0]
  if (first === undefined || findSecret(message) !== undefined) return undefined
  const total = groups.flat().length

  return {
    type: 'question',
    title: clip(total > 1 ? `${first} (+${total - 1})` : first, LIMITS.title),
    body: clip(clean(message), LIMITS.body),
    allowText: true,
  }
}

/** A sortable id from the time and six random hex digits. */
export function newId(now: number, random: () => number): string {
  const d = new Date(now)
  const two = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}`
  const time = `${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}`
  const hex = Math.floor(random() * 0x1000000)
    .toString(16)
    .padStart(6, '0')
    .slice(-6)

  return `${date}-${time}-${hex}`
}

export type ItemContext = {
  id: string
  now: number
  sessionId: string
  root?: string
  defaultProject: string
}

export function makeItem(input: AddInput, ctx: ItemContext): Item {
  return {
    v: 1,
    id: ctx.id,
    type: input.type,
    title: input.title,
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.options === undefined ? {} : { options: input.options }),
    ...(input.recommended === undefined ? {} : { recommended: input.recommended }),
    allowText: input.allowText,
    ...(input.steps === undefined ? {} : { steps: input.steps }),
    project: input.project ?? ctx.defaultProject,
    source: {
      sessionId: ctx.sessionId,
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(ctx.root === undefined ? {} : { root: ctx.root }),
    },
    createdAt: ctx.now,
  }
}

/** The project name from the repository's name, else the folder's. */
export function projectName(root: string, repoName: string | null | undefined): string {
  const fromRepo = repoName?.split('/').filter(Boolean).at(-1)
  if (fromRepo) return oneLine(fromRepo).slice(0, LIMITS.project)
  const fromRoot = root.split(/[\\/]/).filter(Boolean).at(-1)

  return fromRoot ? oneLine(fromRoot).slice(0, LIMITS.project) : 'unknown'
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const isString = (x: unknown): x is string => typeof x === 'string'
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** Whether a file read from disk is an item this version can show. */
export function isItem(x: unknown, id?: string): x is Item {
  if (!isRecord(x) || x.v !== 1) return false
  if (!isString(x.id) || !ID_RE.test(x.id) || (id !== undefined && x.id !== id)) return false
  if (!ITEM_TYPES.includes(x.type as ItemType)) return false
  if (!isString(x.title) || !isString(x.project) || !isNumber(x.createdAt)) return false
  if (!isRecord(x.source) || !isString(x.source.sessionId)) return false
  if (x.body !== undefined && !isString(x.body)) return false
  if (x.options !== undefined && !(Array.isArray(x.options) && x.options.every(isString))) return false
  if (x.steps !== undefined) {
    if (!Array.isArray(x.steps)) return false
    if (!x.steps.every(s => isRecord(s) && isString(s.id) && isString(s.text))) return false
  }
  if (x.closed !== undefined && !(isRecord(x.closed) && isNumber(x.closed.at))) return false
  if (x.captured !== undefined && x.captured !== true) return false

  return typeof x.allowText === 'boolean'
}

export function isResponse(x: unknown, id?: string): x is Response {
  if (!isRecord(x) || x.v !== 1) return false
  if (!isString(x.id) || !ID_RE.test(x.id) || (id !== undefined && x.id !== id)) return false
  if (x.status !== 'draft' && x.status !== 'answered') return false
  if (x.choice !== undefined && !isString(x.choice)) return false
  if (x.text !== undefined && !isString(x.text)) return false
  for (const time of [x.answeredAt, x.archivedAt, x.retractedAt, x.phaseAt]) {
    if (time !== undefined && !isNumber(time)) return false
  }
  if (x.phase !== undefined && x.phase !== 'progress' && x.phase !== 'later') return false
  if (x.phaseNote !== undefined && !isString(x.phaseNote)) return false
  if (x.archived !== undefined && typeof x.archived !== 'boolean') return false
  if (x.steps !== undefined) {
    if (!isRecord(x.steps)) return false
    for (const step of Object.values(x.steps)) {
      if (!isRecord(step)) return false
      if (step.result !== undefined && step.result !== 'pass' && step.result !== 'fail') return false
      if (step.note !== undefined && !isString(step.note)) return false
    }
  }

  return isNumber(x.updatedAt)
}

export function isReceipt(x: unknown, id?: string): x is Receipt {
  if (!isRecord(x) || x.v !== 1) return false
  if (!isString(x.id) || !ID_RE.test(x.id) || (id !== undefined && x.id !== id)) return false

  return isNumber(x.deliveredAt) && isNumber(x.answeredAt)
}

export function statusOf(item: Item, response: Response | undefined): Status {
  if (item.closed !== undefined || response?.archived === true) return 'done'
  if (response?.status === 'answered') return 'answered'

  return response?.phase ?? 'open'
}

/** Whether the owner still has to act on it: open, in progress or put off. */
export const isPending = (status: Status) => status === 'open' || status === 'progress' || status === 'later'

/** When the answer standing now was given; a receipt names it. */
export function answeredAtOf(response: Response): number {
  return response.answeredAt ?? response.updatedAt
}

/** Every item with its response and status, newest first. */
export function buildEntries(
  items: readonly Item[],
  responses: ReadonlyMap<string, Response>,
  seen: Readonly<Record<string, number>>,
  receipts: ReadonlyMap<string, Receipt> = new Map(),
): Entry[] {
  return items
    .map(item => {
      const response = responses.get(item.id)
      const status = statusOf(item, response)
      const receipt = receipts.get(item.id)

      return {
        item,
        ...(response === undefined ? {} : { response }),
        status,
        isNew: status === 'open' && seen[item.id] === undefined,
        delivered:
          response?.status === 'answered' &&
          receipt !== undefined &&
          receipt.answeredAt === answeredAtOf(response),
      }
    })
    .sort((a, b) => b.item.createdAt - a.item.createdAt || (a.item.id < b.item.id ? 1 : -1))
}

export type Group = { project: string; entries: Entry[] }

/** Entries by project, the project with the newest entry first. */
export function groupByProject(entries: readonly Entry[]): Group[] {
  const groups = new Map<string, Entry[]>()
  for (const entry of entries) {
    const list = groups.get(entry.item.project) ?? []
    list.push(entry)
    groups.set(entry.item.project, list)
  }

  return [...groups.entries()]
    .map(([project, list]) => ({ project, entries: list }))
    .sort((a, b) => (b.entries[0]?.item.createdAt ?? 0) - (a.entries[0]?.item.createdAt ?? 0))
}

export type Counts = { open: number; fresh: number; progress: number; later: number }

export function counts(entries: readonly Entry[]): Counts {
  const tally: Counts = { open: 0, fresh: 0, progress: 0, later: 0 }
  for (const entry of entries) {
    if (entry.status === 'open') {
      tally.open += 1
      if (entry.isNew) tally.fresh += 1
    } else if (entry.status === 'progress') {
      tally.progress += 1
    } else if (entry.status === 'later') {
      tally.later += 1
    }
  }

  return tally
}

/**
 * What the session that asked has yet to hear about an item: the owner's
 * answer, the owner putting the item away unanswered, or the owner taking
 * back an answer the session already got. Undefined when it is up to date.
 */
export function deliveryOf(entry: Entry, receipt: Receipt | undefined): Delivery | undefined {
  const { item, response } = entry
  if (item.closed !== undefined || response === undefined) return undefined
  let delivery: Delivery | undefined
  if (response.status === 'answered') {
    delivery = { entry, kind: 'answer', version: answeredAtOf(response) }
  } else {
    // Of the owner's moves since the last answer, the latest is the news.
    const moves: Delivery[] = []
    if (response.archived === true) {
      moves.push({ entry, kind: 'dismissed', version: response.archivedAt ?? response.updatedAt })
    } else if (response.phase !== undefined && response.phaseAt !== undefined) {
      moves.push({ entry, kind: response.phase, version: response.phaseAt })
    }
    if (
      response.retractedAt !== undefined &&
      receipt !== undefined &&
      receipt.answeredAt < response.retractedAt
    ) {
      moves.push({ entry, kind: 'retracted', version: response.retractedAt })
    }
    delivery = moves.sort((a, b) => b.version - a.version)[0]
  }

  return delivery === undefined || receipt?.answeredAt === delivery.version ? undefined : delivery
}

/** What one session has yet to hear about its own items. */
export function dueDeliveries(
  entries: readonly Entry[],
  receipts: ReadonlyMap<string, Receipt>,
  sessionId: string | undefined,
): Delivery[] {
  if (sessionId === undefined) return []
  const due: Delivery[] = []
  for (const entry of entries) {
    if (entry.item.source.sessionId !== sessionId) continue
    const delivery = deliveryOf(entry, receipts.get(entry.item.id))
    if (delivery !== undefined) due.push(delivery)
  }

  return due
}

/** An answered entry as a delivery, for reading answers on demand. */
export function answerDelivery(entry: Entry): Delivery | undefined {
  return entry.response?.status === 'answered'
    ? { entry, kind: 'answer', version: answeredAtOf(entry.response) }
    : undefined
}

/** Fixed choices of the kinds that have no options of their own. */
export const FIXED_CHOICES = {
  approval: ['approved', 'rejected'],
  review: ['done', 'declined'],
  task: ['done', 'declined'],
} as const

const quote = (text: string) => JSON.stringify(text)

function stepLines(item: Item, steps: Readonly<Record<string, StepResult>>): string[] {
  const lines: string[] = []
  let pass = 0
  let failed = 0
  let notRun = 0
  for (const step of item.steps ?? []) {
    const result = steps[step.id]?.result
    if (result === 'pass') pass += 1
    else if (result === 'fail') failed += 1
    else notRun += 1
  }
  lines.push(`${pass} pass, ${failed} fail, ${notRun} not run.`)
  for (const step of item.steps ?? []) {
    const got = steps[step.id]
    const result = got?.result === undefined ? 'NOT RUN' : got.result === 'pass' ? 'pass' : 'FAIL'
    if (got?.result === 'pass' && got.note === undefined) continue
    const note = got?.note === undefined ? '' : ` Note: ${quote(got.note)}`
    const what = oneLine(step.text).slice(0, 120).replace(/[.!?…:;,\s]+$/, '')
    lines.push(`Step ${step.id} ${result}: ${what}.${note}`)
  }

  return lines
}

/** The owner's answer in words the model reads. */
export function describeAnswer(item: Item, response: Response): string {
  const note = response.text === undefined ? '' : ` Note: ${quote(response.text)}`
  switch (item.type) {
    case 'question':
    case 'decision':
      if (response.choice !== undefined) return `Chose ${quote(response.choice)}.${note}`

      return response.text === undefined ? 'No answer given.' : `Answered: ${quote(response.text)}`
    case 'approval':
      return `${response.choice === 'approved' ? 'Approved' : 'Rejected'}.${note}`
    case 'review':
      return `${response.choice === 'declined' ? 'Did not look at it' : 'Looked at it'}.${note}`
    case 'task':
      return `${response.choice === 'declined' ? 'Could not do it' : 'Done'}.${note}`
    case 'test':
      return [...stepLines(item, response.steps ?? {}), ...(note === '' ? [] : [note.trim()])].join('\n')
  }
}

export const TOOL_PREFIX = 'mcp__owner-inbox__'

const NEWS: Record<Exclude<Delivery['kind'], 'answer'>, string> = {
  dismissed:
    'The owner put this item away without answering. Do not wait for an answer; add a new item if you still need one.',
  retracted: 'The owner took back their earlier answer. Do not act on it; a new answer may follow.',
  progress: 'The owner is working on this now. Their answer follows when they are done.',
  later:
    'The owner put this off for later. Keep the item open and work on what does not depend on it; the answer will come later.',
}

function news(delivery: Delivery): string {
  const { entry, kind } = delivery
  if (kind === 'answer') {
    return entry.response === undefined ? 'No answer given.' : describeAnswer(entry.item, entry.response)
  }
  const note = entry.response?.phaseNote
  const withNote = (kind === 'progress' || kind === 'later') && note !== undefined

  return withNote ? `${NEWS[kind]} Note: ${quote(note)}` : NEWS[kind]
}

/** The message that brings the owner's answers to the session that asked. */
export function deliveryText(deliveries: readonly Delivery[]): string {
  const parts = deliveries.map(delivery => {
    const { item } = delivery.entry
    const origin = item.captured === true ? ', taken from your chat message' : ''

    return `[${item.type}] ${quote(item.title)} (id ${item.id}${origin})\n${news(delivery)}`
  })
  const onlyAnswers = deliveries.every(delivery => delivery.kind === 'answer')
  const heading = !onlyAnswers
    ? 'News from the owner inbox:'
    : deliveries.length === 1
      ? 'The owner answered an item in the owner inbox:'
      : `The owner answered ${deliveries.length} items in the owner inbox:`

  const onlyPhases = deliveries.every(delivery => delivery.kind === 'progress' || delivery.kind === 'later')
  const footer = onlyPhases
    ? 'No answer yet: keep these items open.'
    : `Act on the answers. Once an item is handled, close it with ${TOOL_PREFIX}resolve.`

  return [heading, ...parts, footer].join('\n\n')
}

/** One entry as the list and answers tools report it. */
export function toolView(entry: Entry): Record<string, unknown> {
  const { item, response, status } = entry

  return {
    id: item.id,
    type: item.type,
    title: item.title,
    project: item.project,
    ...(item.source.label === undefined ? {} : { from: item.source.label }),
    status,
    created: new Date(item.createdAt).toISOString(),
    ...(response?.status === 'answered' ? { answer: describeAnswer(item, response) } : {}),
    ...((status === 'progress' || status === 'later') && response?.phaseNote !== undefined
      ? { note: response.phaseNote }
      : {}),
    ...(item.closed === undefined ? {} : { closed: item.closed.reason }),
    ...(item.captured === true ? { captured: true } : {}),
  }
}
