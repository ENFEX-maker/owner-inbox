import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { MemFs } from './memfs'

/** The pane's words are checked in German; `auto` would follow the machine. */
const DE = { options: { language: 'de' } }

const HOME = 'C:/Users/someone'
const DIR = `${HOME}/.owner-inbox`
const START = Date.UTC(2026, 10, 18, 9, 0, 0)

const PANE = {
  plugin: 'owner-inbox',
  component: 'Pane',
  requestId: 'owner-inbox',
  props: {
    title: 'Für dich',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type World = {
  fs: MemFs
  clock: ReturnType<typeof mock.clock>
  opened: string[]
  toasts: string[]
  notes: string[]
  prompts: string[]
  /** What the model read beside each prompt that entered. */
  contexts: string[][]
  logs: string[]
  /** Set to make the host refuse the plugin's prompts, as a host may. */
  drop: string | undefined
  /** Set to make something beneath refuse the person's prompts. */
  humanDrop: string | undefined
  /** Starts a new conversation in the same process, as /clear does. */
  clear: (sessionId: string) => void
}

/** Everything beneath the plugin: one session, a folder in memory, a clock. */
function world(on: On, sessionId = 'S1', fs = new MemFs()): World {
  let current = sessionId
  const w: World = {
    fs,
    clock: mock.clock(on, { now: START }),
    opened: [],
    toasts: [],
    notes: [],
    prompts: [],
    contexts: [],
    logs: [],
    drop: undefined,
    humanDrop: undefined,
    clear: next => {
      current = next
    },
  }
  mock.env(on, { USERPROFILE: HOME })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: current }))
  on('session.root', () => ({ value: 'C:/work/demo' }))
  on('session.repo', () => ({ value: null }))
  on('session.surfaces', () => ({ value: ['desktop'] as const }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__owner-inbox__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.read', async (_, e) => ({ value: await fs.read(e.path) }))
  on('fs.write', async (_, e) => {
    await fs.write(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', (_, e) => ({ value: fs.entries(e.path).map(entry => ({ ...entry, kind: 'file' as const, isLink: false })) }))
  on('ui.open', (_, e) => {
    w.opened.push(e.title ?? e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    w.notes.push(e.text)

    return { value: { isSent: true, channel: 'client' } }
  })
  on('prompt.submit', (_, e) => {
    const isPlugin = (e.origin as { kind: string } | undefined)?.kind === 'plugin'
    if (w.drop !== undefined && isPlugin) return { drop: w.drop }
    if (w.humanDrop !== undefined && !isPlugin) return { drop: w.humanDrop }
    w.prompts.push(e.text)
    w.contexts.push([...(e.context ?? [])])

    return { text: e.text }
  })
  on('ui.log', (_, e) => {
    w.logs.push(e.text)

    return { value: undefined }
  })

  return w
}

const add = (args: Record<string, unknown>) => ({ tool: 'mcp__owner-inbox__add' as const, ...args })

/** A plugin tool's answer as the test sees it: the result as the hook gave it. */
function out(ran: { result?: unknown; text?: string; deny?: string }): string | undefined {
  return typeof ran.result === 'string' ? ran.result : (ran.text ?? ran.deny)
}

function idIn(text: string | undefined): string {
  const id = /as (\d{8}-\d{6}-[0-9a-f]{6})/.exec(text ?? '')?.[1]
  if (id === undefined) throw new Error(`no id in ${text}`)

  return id
}

describe('a session adds an item', () => {
  test('it lands on disk, notifies, and shows in the pane on every surface', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ran = await $.tool.call(
      add({ type: 'question', title: 'Ship it?', options: ['Yes', 'No'], recommended: 'Yes', from: 'lead' }),
    )
    expect(ran.deny).toBeUndefined()
    const id = idIn(out(ran))
    expect(fs(w).json(`${DIR}/items/${id}.json`)).toMatchObject({
      type: 'question',
      title: 'Ship it?',
      project: 'demo',
      source: { sessionId: 'S1', label: 'lead', root: 'C:/work/demo' },
    })
    expect(w.notes).toEqual(['Frage: Ship it?'])
    expect(w.opened).toContain('Für dich (1)')

    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ type: 'Text', text: /offen/ }))?.text).toBe('1 offen, davon 1 neu')
      expect((await ui.find({ type: 'Button', text: /Ship it\?/ }))?.text).toMatch(/Frage: Ship it\?.*von lead/)
      await ui.unmount()
    }
  })

  test('a bad call is refused with the reason and writes nothing', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ran = await $.tool.call(add({ type: 'decision', title: 'Pick', options: ['A'] }))
    expect(out(ran)).toMatch(/at least two options/)
    const secret = await $.tool.call(add({ type: 'task', title: `use sk-ant-${'x'.repeat(30)}` }))
    expect(out(secret)).toMatch(/secret/)
    expect(w.fs.names(`${DIR}/items`)).toEqual([])
  })
})

describe('the owner answers', () => {
  test('an option goes back to the session that asked, once', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'question', title: 'Ship it?', options: ['Yes', 'No'] }))))

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `item-${id}` })
    expect((await ui.find({ type: 'Text', text: 'Ship it?' }))?.text).toBe('Ship it?')
    await ui.input({ key: `text-${id}`, text: 'after lunch', kind: 'change' })
    await ui.press({ key: `option-${id}-0` })
    await w.clock.advance(3000)

    expect(w.fs.json(`${DIR}/responses/${id}.json`)).toMatchObject({
      status: 'answered',
      choice: 'Yes',
      text: 'after lunch',
    })
    expect(w.prompts).toHaveLength(1)
    expect(w.prompts[0]).toMatch(`(id ${id})\nChose "Yes". Note: "after lunch"`)
    expect(w.fs.json(`${DIR}/receipts/${id}.json`)).toMatchObject({ id })

    await w.clock.advance(10_000)
    expect(w.prompts).toHaveLength(1)
    expect((await ui.find({ type: 'Text', text: /offen/ }))?.text).toBe('Nichts offen.')
    await ui.unmount()
  })

  test('a test guide is marked step by step and sent with its notes', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(
      out(
        await $.tool.call(
          add({ type: 'test', title: 'Voice check', steps: ['Say hello', { text: 'Ask the time', expect: 'English' }] }),
        ),
      ),
    )
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `item-${id}` })
    await ui.press({ key: `send-${id}` })
    expect((await ui.find({ type: 'Text', text: /mindestens einen Schritt/ }))?.text).toMatch(/„Wie erwartet“ oder „Nicht wie erwartet“/)

    await ui.press({ key: `pass-${id}-1` })
    await ui.press({ key: `fail-${id}-2` })
    await ui.input({ key: `step-note-${id}-2`, text: 'answered in German' })
    expect((await ui.find({ type: 'Text', text: /Notiz gespeichert/ }))?.text).toBe('✓ Notiz gespeichert')
    expect(w.fs.json(`${DIR}/responses/${id}.json`)).toMatchObject({
      status: 'draft',
      steps: { '1': { result: 'pass' }, '2': { result: 'fail', note: 'answered in German' } },
    })
    expect((await ui.find({ key: `send-${id}` }))?.text).toBe('Ergebnis senden (2 von 2 geprüft)')
    await ui.press({ key: `send-${id}` })
    await w.clock.advance(3000)

    expect(w.fs.json(`${DIR}/responses/${id}.json`)).toMatchObject({ status: 'answered' })
    expect(w.prompts[0]).toMatch('1 pass, 1 fail, 0 not run.\nStep 2 FAIL: Ask the time. Note: "answered in German"')
    await ui.unmount()
  })

  test('steps left without a result are sent only on a second press', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'test', title: 'Three steps', steps: ['a', 'b', 'c'] }))))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `item-${id}` })
    await ui.press({ key: `pass-${id}-1` })
    await ui.input({ key: `step-note-${id}-2`, text: 'only a note here', kind: 'change' })
    await ui.press({ key: `send-${id}` })
    expect((await ui.find({ type: 'Text', text: /kein Ergebnis/ }))?.text).toBe(
      'Die Schritte 2, 3 haben noch kein Ergebnis. Drück noch einmal auf „Trotzdem senden“, um so zu senden.',
    )
    expect((await ui.find({ key: `send-${id}` }))?.text).toBe('Trotzdem senden (1 von 3 geprüft)')
    expect(w.fs.json(`${DIR}/responses/${id}.json`)).toMatchObject({ status: 'draft' })

    await ui.press({ key: `send-${id}` })
    await w.clock.advance(3000)
    expect(w.fs.json(`${DIR}/responses/${id}.json`)).toMatchObject({
      status: 'answered',
      steps: { '1': { result: 'pass' }, '2': { note: 'only a note here' } },
    })
    expect(w.prompts[0]).toMatch('1 pass, 0 fail, 2 not run.')
    await ui.unmount()
  })

  test('marking a step takes back the second-press question', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'test', title: 'Two steps', steps: ['a', 'b'] }))))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `item-${id}` })
    await ui.press({ key: `pass-${id}-1` })
    await ui.press({ key: `send-${id}` })
    await ui.press({ key: `fail-${id}-2` })
    expect(await ui.find({ type: 'Text', text: /kein Ergebnis/ })).toBeUndefined()
    expect((await ui.find({ key: `send-${id}` }))?.text).toBe('Ergebnis senden (2 von 2 geprüft)')
    expect(w.prompts).toEqual([])
    await ui.unmount()
  })

  test('a secret typed as an answer is held back with a warning', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'question', title: 'Which key?' }))))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `item-${id}` })
    await ui.input({ key: `text-${id}`, text: `ghp_${'a'.repeat(36)}` })
    expect((await ui.find({ type: 'Text', text: /Passwort oder Schlüssel/ }))?.text).toMatch(/Nicht gesendet/)
    expect(w.fs.names(`${DIR}/responses`)).toEqual([])
    expect(w.prompts).toEqual([])
    await ui.unmount()
  })

  test('an approval with a note, then taken back and changed', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'approval', title: 'Delete the old logs?' }))))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `item-${id}` })
    await ui.press({ key: `no-${id}` })
    await w.clock.advance(3000)
    expect(w.prompts[0]).toMatch('Rejected.')

    await ui.press({ key: 'section-answered' })
    await ui.press({ key: `item-${id}` })
    await ui.press({ key: `undo-${id}` })
    expect(w.fs.json(`${DIR}/responses/${id}.json`)).toMatchObject({ status: 'draft' })
    await ui.input({ key: `note-${id}`, text: 'keep last week', kind: 'change' })
    await ui.press({ key: `yes-${id}` })
    await w.clock.advance(3000)
    expect(w.prompts).toHaveLength(2)
    expect(w.prompts[1]).toMatch('Approved. Note: "keep last week"')
    await ui.unmount()
  })
})

describe('when the host does not take the wake-up message', () => {
  test('the answer is not marked delivered, and goes along with the next tool result', DE, async ($, on) => {
    const w = world(on)
    w.drop = 'the host takes no plugin prompts'
    on('tool.call', () => ({ result: { stdout: 'ok' } }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'question', title: 'Ship it?', options: ['Yes', 'No'] }))))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `item-${id}` })
    await ui.press({ key: `option-${id}-0` })
    await w.clock.advance(3000)

    expect(w.prompts).toEqual([])
    expect(w.fs.names(`${DIR}/receipts`)).toEqual([])
    expect(w.logs).toEqual([
      "owner-inbox: could not wake this session with the owner's answer (the host takes no plugin prompts); it goes along with the next tool result or prompt.",
    ])
    await ui.press({ key: 'section-answered' })
    await ui.press({ key: `item-${id}` })
    expect((await ui.find({ type: 'Text', text: /angekommen/ }))?.text).toBe('Bei der Sitzung noch nicht angekommen.')

    const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(ran.context?.join('\n')).toMatch(`(id ${id})\nChose "Yes".`)
    expect(w.fs.json(`${DIR}/receipts/${id}.json`)).toMatchObject({ id })
    expect((await ui.find({ type: 'Text', text: /angekommen/ }))?.text).toBe('Bei der Sitzung angekommen.')

    // Delivered once: the next call carries nothing, and no retry wakes it again.
    expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).context).toBeUndefined()
    await w.clock.advance(120_000)
    expect(w.logs).toHaveLength(1)
    await ui.unmount()
  })

  test('or with the next prompt the owner types', DE, async ($, on) => {
    const w = world(on)
    w.drop = 'busy'
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'task', title: 'Plug in the mic' }))))
    w.fs.put(
      `${DIR}/responses/${id}.json`,
      JSON.stringify({ v: 1, id, status: 'answered', choice: 'done', updatedAt: START, answeredAt: START }),
    )
    await w.clock.advance(3000)
    expect(w.fs.names(`${DIR}/receipts`)).toEqual([])

    w.drop = undefined
    // As the person types it: no origin, as in a session.
    await $.prompt.submit({ text: 'How is it going?' } as never)
    expect(w.prompts).toEqual(['How is it going?'])
    expect(w.contexts[0]?.join('\n')).toMatch(`[task] "Plug in the mic" (id ${id})\nDone.`)
    expect(w.fs.json(`${DIR}/receipts/${id}.json`)).toMatchObject({ id })
  })
})

describe('what the review found', () => {
  const otherItem = (id: string, title: string) =>
    JSON.stringify({
      v: 1,
      id,
      type: 'approval',
      title,
      allowText: true,
      project: 'demo',
      source: { sessionId: 'S2', label: 'docs' },
      createdAt: START + 1000,
    })
  const answeredBy = (id: string, choice: string, at = START + 2000) =>
    JSON.stringify({ v: 1, id, status: 'answered', choice, updatedAt: at, answeredAt: at })

  test("reading the project's answers leaves other sessions' answers theirs to receive", DE, async ($, on) => {
    const w = world(on, 'S1')
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const other = '20261118-090500-0000bb'
    w.fs.put(`${DIR}/items/${other}.json`, otherItem(other, 'Delete the old logs?'))
    w.fs.put(`${DIR}/responses/${other}.json`, answeredBy(other, 'approved'))
    const got = await $.tool.call({ tool: 'mcp__owner-inbox__answers', scope: 'project' })
    expect(out(got)).toMatch(`(id ${other})\nApproved.`)
    expect(w.fs.names(`${DIR}/receipts`)).toEqual([])
  })

  test('an answer sent with a prompt that is then dropped stays due', DE, async ($, on) => {
    const w = world(on)
    w.drop = 'no plugin prompts'
    w.humanDrop = 'a settings hook said no'
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'task', title: 'Plug in the mic' }))))
    w.fs.put(`${DIR}/responses/${id}.json`, answeredBy(id, 'done'))
    await w.clock.advance(3000)
    await $.prompt.submit({ text: 'Status?' } as never)
    expect(w.fs.names(`${DIR}/receipts`)).toEqual([])

    w.humanDrop = undefined
    await $.prompt.submit({ text: 'Status now?' } as never)
    expect(w.contexts.at(-1)?.join('\n')).toMatch(`(id ${id})\nDone.`)
    expect(w.fs.json(`${DIR}/receipts/${id}.json`)).toMatchObject({ id })
  })

  test('after /clear, the earlier conversation is not woken in the new one', DE, async ($, on) => {
    const w = world(on, 'S1')
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'approval', title: 'Delete the old logs?' }))))
    w.clear('S1-new')
    w.fs.put(`${DIR}/responses/${id}.json`, answeredBy(id, 'approved'))
    await w.clock.advance(10_000)
    expect(w.prompts).toEqual([])
    expect(out(await $.tool.call({ tool: 'mcp__owner-inbox__answers' }))).toBe('No answers and nothing waiting.')
    expect(out(await $.tool.call({ tool: 'mcp__owner-inbox__answers', scope: 'project' }))).toMatch('Approved.')
  })

  test('a tool call that reads the folder does not hide a change from the pane', DE, async ($, on) => {
    const w = world(on, 'S1')
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const other = '20261118-090500-0000cc'
    w.fs.put(`${DIR}/items/${other}.json`, otherItem(other, 'Rotate the backup disk'))
    await $.tool.call({ tool: 'mcp__owner-inbox__list', scope: 'all' })
    await w.clock.advance(3000)
    expect(w.toasts).toEqual(['Neu für dich: Rotate the backup disk'])
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Button', text: /Rotate the backup disk/ }))?.text).toMatch(/Freigabe/)
    await ui.unmount()
  })

  test('no session writes into the inbox folder by hand', DE, async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: { ok: true } }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const forged = await $.tool.call({
      tool: 'Write',
      file_path: `${HOME}\\.owner-inbox\\responses\\20261118-090500-0000dd.json`,
      content: '{}',
    })
    expect(forged.deny).toMatch(/only by the mcp__owner-inbox__\* tools/)
    const shell = await $.tool.call({ tool: 'Bash', command: 'echo {} > ~/.owner-inbox/responses/x.json' })
    expect(shell.deny).toMatch(/owner's own pane/)
    expect((await $.tool.call({ tool: 'Write', file_path: 'C:/work/demo/notes.md', content: 'x' })).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Read', file_path: `${DIR}/items/x.json` })).deny).toBeUndefined()
  })

  test('the session hears when the owner puts its item away or takes an answer back', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const away = idIn(out(await $.tool.call(add({ type: 'task', title: 'Buy a new mic' }))))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `item-${away}` })
    await ui.press({ key: `dismiss-${away}` })
    await w.clock.advance(3000)
    expect(w.prompts.at(-1)).toMatch(`(id ${away})\nThe owner put this item away without answering.`)

    const asked = idIn(out(await $.tool.call(add({ type: 'approval', title: 'Restart the server?' }))))
    await ui.press({ key: `item-${asked}` })
    await ui.press({ key: `yes-${asked}` })
    await w.clock.advance(3000)
    expect(w.prompts.at(-1)).toMatch('Approved.')
    await ui.press({ key: 'section-answered' })
    await ui.press({ key: `item-${asked}` })
    await ui.press({ key: `undo-${asked}` })
    await w.clock.advance(3000)
    expect(w.prompts.at(-1)).toMatch(`(id ${asked})\nThe owner took back their earlier answer.`)
    expect(w.prompts).toHaveLength(3)
    await w.clock.advance(10_000)
    expect(w.prompts).toHaveLength(3)
    await ui.unmount()
  })

  test('two quick marks are both kept', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'test', title: 'Two steps', steps: ['a', 'b'] }))))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `item-${id}` })
    await Promise.all([ui.press({ key: `pass-${id}-1` }), ui.press({ key: `fail-${id}-2` })])
    expect(w.fs.json(`${DIR}/responses/${id}.json`)).toMatchObject({
      steps: { '1': { result: 'pass' }, '2': { result: 'fail' } },
    })
    await ui.unmount()
  })
})

describe('several sessions share one inbox', () => {
  test("another session's item arrives by itself; its answer is not this session's to deliver", DE, async ($, on) => {
    const w = world(on, 'S1')
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const other = '20261118-090500-0000aa'
    w.fs.put(
      `${DIR}/items/${other}.json`,
      JSON.stringify({
        v: 1,
        id: other,
        type: 'task',
        title: 'Plug in the microphone',
        allowText: true,
        project: 'robot',
        source: { sessionId: 'S2', label: 'docs' },
        createdAt: START + 1000,
      }),
    )
    await w.clock.advance(3000)
    expect(w.toasts).toEqual(['Neu für dich: Plug in the microphone'])
    expect(w.opened).toContain('Für dich (1)')

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: 'robot' }))?.text).toBe('robot')
    await ui.press({ key: `item-${other}` })
    await ui.press({ key: `yes-${other}` })
    await w.clock.advance(3000)
    expect(w.fs.json(`${DIR}/responses/${other}.json`)).toMatchObject({ status: 'answered', choice: 'done' })
    expect(w.prompts).toEqual([])
    await ui.unmount()
  })
})

describe('the session reads answers back', () => {
  test('answers fetches them and marks them delivered; resolve closes the item', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const id = idIn(out(await $.tool.call(add({ type: 'task', title: 'Restart the PC' }))))

    const none = await $.tool.call({ tool: 'mcp__owner-inbox__answers' })
    expect(out(none)).toBe(`No answers yet; 1 item(s) still open: ${id}.`)

    // The owner answers in another session's pane.
    w.fs.put(
      `${DIR}/responses/${id}.json`,
      JSON.stringify({ v: 1, id, status: 'answered', choice: 'done', updatedAt: START, answeredAt: START }),
    )
    const got = await $.tool.call({ tool: 'mcp__owner-inbox__answers' })
    expect(out(got)).toMatch(`[task] "Restart the PC" (id ${id})\nDone.`)
    expect(w.fs.json(`${DIR}/receipts/${id}.json`)).toMatchObject({ answeredAt: START })
    await w.clock.advance(3000)
    expect(w.prompts).toEqual([])

    const closed = await $.tool.call({ tool: 'mcp__owner-inbox__resolve', ids: [id, '../x'], note: 'thanks' })
    expect(out(closed)).toBe(`${id}: closed (done).\n../x: not an inbox id.`)
    expect(w.fs.json(`${DIR}/items/${id}.json`)).toMatchObject({ closed: { reason: 'done', note: 'thanks' } })
    const listed = await $.tool.call({ tool: 'mcp__owner-inbox__list', status: 'done' })
    expect(JSON.parse(out(listed) ?? '[]')).toMatchObject([{ id, status: 'done', closed: 'done' }])
    expect(out(await $.tool.call({ tool: 'mcp__owner-inbox__list' }))).toBe('No items.')
  })
})

describe('the rest of the wiring', () => {
  test('the system prompt explains the inbox where its tool is offered', DE, async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude.', scope: 'shared' as const }] }))
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const input = { model: 'm', promptModel: 'm', surfaces: ['desktop'] as const, outputStyle: null, traits: [] }
    const withTool = await $.prompt.compose({ ...input, tools: ['Read', 'mcp__owner-inbox__add'] })
    expect(withTool.sections.map(section => section.id)).toEqual(['intro', 'owner-inbox:guide'])
    expect(withTool.sections[1]?.text).toMatch(/never waits for the owner/)
    const without = await $.prompt.compose({ ...input, tools: ['Read'] })
    expect(without.sections.map(section => section.id)).toEqual(['intro'])
  })

  test('the band above the prompt counts what is open and opens the pane', DE, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const band = {
      plugin: 'owner-inbox',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isCollapsed: false, isWorking: false },
    } as never
    const empty = await $.ui.mount({ ...(band as object), surface: 'desktop' } as never)
    expect(await (empty as { find: (q: object) => Promise<unknown> }).find({ key: 'open-inbox' })).toBeUndefined()
    await (empty as { unmount: () => Promise<void> }).unmount()

    await $.tool.call(add({ type: 'task', title: 'Water the plants' }))
    w.opened.length = 0
    const ui = await $.ui.mount({ ...(band as object), surface: 'desktop' } as never)
    const mounted = ui as {
      find: (q: object) => Promise<{ text: string } | undefined>
      press: (q: object) => Promise<unknown>
      unmount: () => Promise<void>
    }
    expect((await mounted.find({ key: 'open-inbox' }))?.text).toBe('Für dich: 1 offen, 1 neu')
    await mounted.press({ key: 'open-inbox' })
    expect(w.opened).toEqual(['Für dich (1)'])
    await mounted.unmount()
  })

  test('English on request', { options: { language: 'en' } }, async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.tool.call(add({ type: 'review', title: 'Read the README' }))
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /open/ }))?.text).toBe('1 open, 1 new')
    expect((await ui.find({ type: 'Button', text: /README/ }))?.text).toMatch(/^● Look at: Read the README/)
    await ui.unmount()
  })
})

function fs(w: World): MemFs {
  return w.fs
}
