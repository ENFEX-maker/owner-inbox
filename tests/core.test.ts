import { describe, expect, test } from 'claude-code/testing'

import {
  answerDelivery,
  buildEntries,
  chatCapture,
  chatQuestions,
  counts,
  deliveryText,
  describeAnswer,
  dueDeliveries,
  findSecret,
  groupByProject,
  ID_RE,
  isItem,
  isResponse,
  makeItem,
  newId,
  parseAdd,
  projectName,
  statusOf,
  toolView,
} from '../hooks/core'
import type { Entry, Item, Receipt, Response } from '../types'

const ID = '20261118-101500-abcdef'

function item(over: Partial<Item> = {}): Item {
  return {
    v: 1,
    id: ID,
    type: 'question',
    title: 'Ship it?',
    allowText: true,
    project: 'demo',
    source: { sessionId: 'S1' },
    createdAt: 1000,
    ...over,
  }
}

function answered(over: Partial<Response> = {}): Response {
  return { v: 1, id: ID, status: 'answered', choice: 'Yes', updatedAt: 2000, answeredAt: 2000, ...over }
}

describe('parseAdd', () => {
  test('accepts a question with options and a recommendation', () => {
    const parsed = parseAdd({
      type: 'question',
      title: '  Ship   it? ',
      options: ['Yes', 'No', 'yes', ''],
      recommended: 'yes',
      body: '## Why\nBecause.',
    })
    expect(parsed).toEqual({
      ok: true,
      value: {
        type: 'question',
        title: 'Ship it?',
        allowText: true,
        body: '## Why\nBecause.',
        options: ['Yes', 'No'],
        recommended: 'Yes',
      },
    })
  })

  test('a question without options always takes free text', () => {
    const parsed = parseAdd({ type: 'question', title: 'Name?', allow_text: false })
    expect(parsed.ok && parsed.value.allowText).toBe(true)
  })

  test('allow_text false holds once there are options', () => {
    const parsed = parseAdd({ type: 'decision', title: 'Pick', options: ['A', 'B'], allow_text: false })
    expect(parsed.ok && parsed.value.allowText).toBe(false)
  })

  test('refuses what does not fit, naming the field', () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ title: 'x' }, /type must be one of/],
      [{ type: 'memo', title: 'x' }, /type must be one of/],
      [{ type: 'task' }, /title is required/],
      [{ type: 'task', title: '   ' }, /title is required/],
      [{ type: 'decision', title: 'x', options: ['A'] }, /at least two options/],
      [{ type: 'question', title: 'x', options: ['A'] }, /at least two options/],
      [{ type: 'approval', title: 'x', options: ['A', 'B'] }, /options are only for/],
      [{ type: 'question', title: 'x', options: 'A, B' }, /list of strings/],
      [{ type: 'question', title: 'x', options: ['A', 'B'], recommended: 'C' }, /one of the options/],
      [{ type: 'test', title: 'x' }, /needs steps/],
      [{ type: 'test', title: 'x', steps: [] }, /needs steps/],
      [{ type: 'test', title: 'x', steps: [{ expect: 'y' }] }, /a step has no text/],
      [{ type: 'task', title: 'x', steps: ['a'] }, /only for type test/],
      [{ type: 'task', title: 'x', body: 'y'.repeat(20001) }, /body is longer/],
      [{ type: 'task', title: 'x', allow_text: 'yes' }, /allow_text must be/],
      [{ type: 'question', title: 'x', options: Array.from({ length: 9 }, (_, i) => `o${i}`) }, /at most 8/],
    ]
    for (const [raw, error] of cases) {
      const parsed = parseAdd(raw)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toMatch(error)
    }
  })

  test('cuts an overlong title instead of refusing it', () => {
    const parsed = parseAdd({ type: 'task', title: 'a'.repeat(500) })
    expect(parsed.ok && parsed.value.title.length).toBe(200)
  })

  test('numbers test steps and keeps what they expect', () => {
    const parsed = parseAdd({
      type: 'test',
      title: 'Voice check',
      steps: ['Say hello', { text: 'Ask the time', expect: 'It answers in English' }],
    })
    expect(parsed.ok && parsed.value.steps).toEqual([
      { id: '1', text: 'Say hello' },
      { id: '2', text: 'Ask the time', expect: 'It answers in English' },
    ])
  })

  test('refuses a secret anywhere in the item', () => {
    const key = `sk-ant-api03-${'x'.repeat(30)}`
    for (const raw of [
      { type: 'task', title: `use ${key}` },
      { type: 'task', title: 'x', body: `the key is ${key}` },
      { type: 'question', title: 'x', options: [key, 'other'] },
      { type: 'test', title: 'x', steps: [{ text: 'a', expect: `token = ${'A1'.repeat(10)}` }] },
    ]) {
      const parsed = parseAdd(raw)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toMatch(/secret/)
    }
  })

  test('strips control characters', () => {
    const parsed = parseAdd({ type: 'task', title: 'a\u0007b', body: 'line\u0000\nnext' })
    expect(parsed.ok && parsed.value.title).toBe('ab')
    expect(parsed.ok && parsed.value.body).toBe('line\nnext')
  })
})

describe('findSecret', () => {
  test('finds the common kinds', () => {
    // Built from parts, so no key-shaped literal sits in the repository.
    const part = (...pieces: string[]) => pieces.join('')
    const hits = [
      'DB_PASSWORD=Sup3rSecret!',
      'GITHUB_TOKEN=abc123def456',
      part('AWS_SECRET_ACCESS_KEY=', 'abcd1234/', 'efgh5678/', 'ijkl9012'),
      'password: Hunter2!Hunter2!',
      `sk-ant-api03-${'a'.repeat(40)}`,
      `ghp_${'a'.repeat(36)}`,
      `github_pat_${'a'.repeat(30)}`,
      part('AK', 'IA', 'ABCDEFGHIJKLMNOP'),
      'xoxb-1234567890-abcdef',
      '-----BEGIN RSA PRIVATE KEY-----',
      `tskey-auth-${'a'.repeat(20)}`,
      part('eyJ', 'hbGciOiJIUzI1NiJ9', '.eyJ', 'zdWIiOiIxMjM0NTY3ODkwIn0', '.abcdefgh12345678'),
      'password: hunter2hunter2',
      'API_KEY="abcd1234efgh5678"',
    ]
    for (const text of hits) expect(findSecret(text)).toBeDefined()
  })

  test('leaves ordinary text alone', () => {
    const misses = [
      'Set the token in the config file.',
      'token = os.environ["X"]',
      'password: see the vault',
      'The skeleton key scene is done.',
      'Run task sk-1 next.',
      'token = process.env.API_TOKEN',
      'Set TOKEN_LIMIT: 4000 in the config',
      'The passwords: all rotated last week.',
    ]
    for (const text of misses) expect(findSecret(text)).toBeUndefined()
  })
})

describe('ids and projects', () => {
  test('newId sorts by time and matches the file-name rule', () => {
    const a = newId(Date.UTC(2026, 10, 18, 10, 15, 0), () => 0.5)
    const b = newId(Date.UTC(2026, 10, 18, 10, 15, 1), () => 0)
    expect(a).toBe('20261118-101500-800000')
    expect(ID_RE.test(a) && ID_RE.test(b)).toBe(true)
    expect(a < b).toBe(true)
  })

  test('the id rule refuses paths', () => {
    for (const bad of ['../x', '20261118-101500-abcdef/../../x', '20261118-101500-ABCDEF', '']) {
      expect(ID_RE.test(bad)).toBe(false)
    }
  })

  test('projectName prefers the repository name', () => {
    expect(projectName('C:\\work\\wt-feature', 'acme/widget')).toBe('widget')
    expect(projectName('C:\\work\\widget\\', null)).toBe('widget')
    expect(projectName('/home/a/proj', undefined)).toBe('proj')
    expect(projectName('', null)).toBe('unknown')
  })

  test('makeItem fills project and source', () => {
    const made = makeItem(
      { type: 'task', title: 'Plug in the mic', allowText: true, label: 'lead' },
      { id: ID, now: 5, sessionId: 'S1', root: 'C:/p', defaultProject: 'p' },
    )
    expect(made).toEqual({
      v: 1,
      id: ID,
      type: 'task',
      title: 'Plug in the mic',
      allowText: true,
      project: 'p',
      source: { sessionId: 'S1', label: 'lead', root: 'C:/p' },
      createdAt: 5,
    })
    expect(isItem(made, ID)).toBe(true)
    expect(isItem({ ...made, id: '../evil' })).toBe(false)
    expect(isItem(made, '20261118-101500-000000')).toBe(false)
  })
})

describe('questions in a chat message', () => {
  test('finds the questions that close a message', () => {
    expect(chatQuestions('Done.\n\nShould I push it now? Or wait for the review?')).toEqual([
      ['Should I push it now?', 'Or wait for the review?'],
    ])
    const listed = [
      'All set.',
      '',
      '**Für dich, offen:**',
      '1. Passt dir der Projektordner, oder lieber woanders?',
      '2. Ist der Name „Owner Inbox“ okay?',
    ].join('\n')
    expect(chatQuestions(listed)).toEqual([
      ['Passt dir der Projektordner, oder lieber woanders?', 'Ist der Name „Owner Inbox“ okay?'],
    ])
    expect(chatQuestions('終わりました。\n\n今すぐ公開しますか？')).toEqual([['今すぐ公開しますか？']])
  })

  test('leaves out code, quotes, links, headings and questions far up', () => {
    const quiet = [
      '## Why did it fail?',
      '',
      '> Can we trust the cache?',
      '',
      '```ts',
      'const ok = ready ? go() : stop()',
      'if (x?.y) {}',
      '```',
      '',
      'See `a?b` and https://example.com/path?query=1 for more.',
      '',
      '**Was ist neu?**',
      '',
      'Fixed it.',
    ].join('\n')
    expect(chatQuestions(quiet)).toEqual([])
    const farUp = ['Is this the first question?', 'Block two.', 'Block three.', 'Block four.', 'Done.'].join('\n\n')
    expect(chatQuestions(farUp)).toEqual([])
    expect(chatQuestions('Why?')).toEqual([])
  })

  test('the captured item: the last block\'s first question as title, the message as body', () => {
    const message = 'Is the first draft fine?\n\nNext steps.\n\nShall I publish it? And tag it?'
    expect(chatCapture(message)).toEqual({
      type: 'question',
      title: 'Shall I publish it? (+2)',
      body: message,
      allowText: true,
    })
    expect(chatCapture('All done.')).toBeUndefined()
    expect(chatCapture(`Use ghp_${'a'.repeat(36)} for it?`)).toBeUndefined()
    expect(chatCapture(`${'x'.repeat(300)}?`)?.title).toHaveLength(200)
  })
})

describe('files from other writers', () => {
  test('a response is checked field by field', () => {
    const good = answered()
    expect(isResponse(good, ID)).toBe(true)
    expect(isResponse({ ...good, answeredAt: 'soon' })).toBe(false)
    expect(isResponse({ ...good, archived: 'yes' })).toBe(false)
    expect(isResponse({ ...good, steps: { '1': { result: 'maybe' } } })).toBe(false)
    expect(isResponse({ ...good, steps: { '1': { note: 5 } } })).toBe(false)
    expect(isResponse({ ...good, steps: { '1': { result: 'fail', note: 'x' } } })).toBe(true)
    expect(isResponse({ ...good, phase: 'someday' })).toBe(false)
    expect(isResponse({ ...good, phase: 'later', phaseAt: 'now' })).toBe(false)
    expect(isResponse({ ...good, phase: 'later', phaseAt: 5, phaseNote: 'x' })).toBe(true)
  })
})

describe('status and delivery', () => {
  test('status follows the response and the close', () => {
    expect(statusOf(item(), undefined)).toBe('open')
    expect(statusOf(item(), answered({ status: 'draft' }))).toBe('open')
    expect(statusOf(item(), answered())).toBe('answered')
    expect(statusOf(item(), answered({ archived: true }))).toBe('done')
    expect(statusOf(item({ closed: { at: 3, reason: 'done' } }), answered())).toBe('done')
  })

  test('entries are newest first, new until seen, delivered by receipt', () => {
    const older = item({ id: '20261118-090000-000001', createdAt: 1 })
    const newer = item({ id: '20261118-100000-000002', createdAt: 2 })
    const responses = new Map([[newer.id, answered({ id: newer.id })]])
    const receipts = new Map<string, Receipt>([[newer.id, { v: 1, id: newer.id, deliveredAt: 3, answeredAt: 2000 }]])
    const entries = buildEntries([older, newer], responses, {}, receipts)
    expect(entries.map(entry => entry.item.id)).toEqual([newer.id, older.id])
    expect(entries.map(entry => entry.isNew)).toEqual([false, true])
    expect(entries.map(entry => entry.delivered)).toEqual([true, false])
    expect(counts(entries)).toEqual({ open: 1, fresh: 1, progress: 0, later: 0 })
    expect(buildEntries([older], new Map(), { [older.id]: 9 })[0]?.isNew).toBe(false)
  })

  test('an answer is due for the asking session until a receipt names it', () => {
    const entries = buildEntries([item()], new Map([[ID, answered()]]), {})
    const mine = 'S1'
    expect(dueDeliveries(entries, new Map(), mine)).toHaveLength(1)
    expect(dueDeliveries(entries, new Map(), mine)[0]).toMatchObject({ kind: 'answer', version: 2000 })
    expect(dueDeliveries(entries, new Map(), 'S2')).toHaveLength(0)
    expect(dueDeliveries(entries, new Map(), undefined)).toHaveLength(0)
    const receipt: Receipt = { v: 1, id: ID, deliveredAt: 1, answeredAt: 2000 }
    expect(dueDeliveries(entries, new Map([[ID, receipt]]), mine)).toHaveLength(0)
    // A changed answer is due again.
    const changed = buildEntries([item()], new Map([[ID, answered({ answeredAt: 3000 })]]), {})
    expect(dueDeliveries(changed, new Map([[ID, receipt]]), mine)).toHaveLength(1)
    // A closed item is not.
    const closed = buildEntries([item({ closed: { at: 1, reason: 'done' } })], new Map([[ID, answered()]]), {})
    expect(dueDeliveries(closed, new Map(), mine)).toHaveLength(0)
  })

  test('the owner files an item as in progress or later, and the latest move is the news', () => {
    const draft = (over: Partial<Response>) =>
      answered({ status: 'draft', choice: undefined, answeredAt: undefined, ...over })
    expect(statusOf(item(), draft({ phase: 'progress', phaseAt: 3000 }))).toBe('progress')
    expect(statusOf(item(), draft({ phase: 'later', phaseAt: 3000 }))).toBe('later')
    expect(statusOf(item(), answered({ phase: 'later', phaseAt: 3000 }))).toBe('answered')

    const later = buildEntries([item()], new Map([[ID, draft({ phase: 'later', phaseAt: 3000, phaseNote: 'after lunch' })]]), {})
    expect(counts(later)).toEqual({ open: 0, fresh: 0, progress: 0, later: 1 })
    const due = dueDeliveries(later, new Map(), 'S1')
    expect(due).toMatchObject([{ kind: 'later', version: 3000 }])
    const text = deliveryText(due)
    expect(text).toMatch(/^News from the owner inbox:/)
    expect(text).toMatch('The owner put this off for later.')
    expect(text).toMatch('Note: "after lunch"')
    expect(text).toMatch(/No answer yet: keep these items open\.$/)
    const heard: Receipt = { v: 1, id: ID, deliveredAt: 3001, answeredAt: 3000 }
    expect(dueDeliveries(later, new Map([[ID, heard]]), 'S1')).toEqual([])

    // A move after a taken-back answer: the newer one is told.
    const got: Receipt = { v: 1, id: ID, deliveredAt: 2001, answeredAt: 2000 }
    const both = buildEntries([item()], new Map([[ID, draft({ retractedAt: 2500, phase: 'progress', phaseAt: 2600 })]]), {})
    expect(dueDeliveries(both, new Map([[ID, got]]), 'S1')).toMatchObject([{ kind: 'progress', version: 2600 }])
    expect(toolView(later[0] as Entry)).toMatchObject({ status: 'later', note: 'after lunch' })
  })

  test('putting an item away unanswered, and taking an answer back, are news too', () => {
    const away = buildEntries(
      [item()],
      new Map([[ID, answered({ status: 'draft', choice: undefined, answeredAt: undefined, archived: true, archivedAt: 3000 })]]),
      {},
    )
    expect(dueDeliveries(away, new Map(), 'S1')).toMatchObject([{ kind: 'dismissed', version: 3000 }])
    const told: Receipt = { v: 1, id: ID, deliveredAt: 3001, answeredAt: 3000 }
    expect(dueDeliveries(away, new Map([[ID, told]]), 'S1')).toEqual([])

    const retracted = answered({ status: 'draft', answeredAt: undefined, retractedAt: 4000 })
    const back = buildEntries([item()], new Map([[ID, retracted]]), {})
    // Never delivered: nothing to take back.
    expect(dueDeliveries(back, new Map(), 'S1')).toEqual([])
    // Delivered before: the session must hear it is void.
    const got: Receipt = { v: 1, id: ID, deliveredAt: 2001, answeredAt: 2000 }
    expect(dueDeliveries(back, new Map([[ID, got]]), 'S1')).toMatchObject([{ kind: 'retracted', version: 4000 }])
    const heard: Receipt = { v: 1, id: ID, deliveredAt: 4001, answeredAt: 4000 }
    expect(dueDeliveries(back, new Map([[ID, heard]]), 'S1')).toEqual([])
  })

  test('groups by project, the newest project first', () => {
    const entries = buildEntries(
      [
        item({ id: '20261118-090000-000001', project: 'a', createdAt: 1 }),
        item({ id: '20261118-090000-000002', project: 'b', createdAt: 3 }),
        item({ id: '20261118-090000-000003', project: 'a', createdAt: 2 }),
      ],
      new Map(),
      {},
    )
    expect(groupByProject(entries).map(group => [group.project, group.entries.length])).toEqual([
      ['b', 1],
      ['a', 2],
    ])
  })
})

describe('what the model reads', () => {
  test('describes each kind of answer', () => {
    expect(describeAnswer(item(), answered({ text: 'but wait a day' }))).toBe(
      'Chose "Yes". Note: "but wait a day"',
    )
    expect(describeAnswer(item(), answered({ choice: undefined, text: 'Call it Ada' }))).toBe(
      'Answered: "Call it Ada"',
    )
    expect(describeAnswer(item({ type: 'approval' }), answered({ choice: 'rejected' }))).toBe('Rejected.')
    expect(describeAnswer(item({ type: 'task' }), answered({ choice: 'declined', text: 'no mic' }))).toBe(
      'Could not do it. Note: "no mic"',
    )
    expect(describeAnswer(item({ type: 'review' }), answered({ choice: 'done' }))).toBe('Looked at it.')
  })

  test('a test result names failures, notes and steps not run', () => {
    const test = item({
      type: 'test',
      steps: [
        { id: '1', text: 'Say hello' },
        { id: '2', text: 'Ask the time' },
        { id: '3', text: 'Say stop...' },
      ],
    })
    const text = describeAnswer(
      test,
      answered({
        choice: undefined,
        steps: { '1': { result: 'pass' }, '2': { result: 'fail', note: 'answered in German' } },
        text: 'mic was far away',
      }),
    )
    expect(text).toBe(
      [
        '1 pass, 1 fail, 1 not run.',
        'Step 2 FAIL: Ask the time. Note: "answered in German"',
        'Step 3 NOT RUN: Say stop.',
        'Note: "mic was far away"',
      ].join('\n'),
    )
  })

  test('the delivery names every item and how to close it', () => {
    const entries = buildEntries([item()], new Map([[ID, answered()]]), {})
    const text = deliveryText(entries.map(answerDelivery).filter(one => one !== undefined))
    expect(text).toMatch(/^The owner answered an item in the owner inbox:/)
    expect(text).toMatch(`[question] "Ship it?" (id ${ID})\nChose "Yes".`)
    expect(text).toMatch(/mcp__owner-inbox__resolve/)
  })

  test('the tool view carries the answer once given', () => {
    const [entry] = buildEntries([item({ source: { sessionId: 'S1', label: 'lead' } })], new Map([[ID, answered()]]), {})
    expect(entry && toolView(entry)).toEqual({
      id: ID,
      type: 'question',
      title: 'Ship it?',
      project: 'demo',
      from: 'lead',
      status: 'answered',
      created: new Date(1000).toISOString(),
      answer: 'Chose "Yes".',
    })
  })
})
