// The pane beside the chat: the list of what waits for the owner, grouped by
// project, and one item opened with the buttons that answer it. It draws from
// a model and calls actions; it reads and writes nothing itself.
import type { Entry, Item, Response, Sections, StepResult } from '../types'
import { counts, groupByProject } from './core'
import { formatTime, type Strings } from './i18n'

/** The elements a surface's table holds that the pane uses. */
// biome-ignore lint/suspicious/noExplicitAny: each surface's table has its own constructor types
export type Elements = { Box: any; Text: any; Button: any; Input: any; Markdown: any }

export type Actions = {
  select: (id: string | null) => void
  toggle: (section: keyof Sections) => void
  /** An option, or a fixed choice (approved, rejected, done, declined). */
  choose: (id: string, choice: string) => void
  sendText: (id: string, text: string) => void
  draft: (key: string, text: string) => void
  draftOf: (key: string) => string | undefined
  mark: (id: string, stepId: string, result: 'pass' | 'fail') => void
  saveStepNote: (id: string, stepId: string, text: string) => void
  sendTest: (id: string) => void
  undo: (id: string) => void
  archive: (id: string) => void
}

export type PaneModel = {
  entries: readonly Entry[]
  selected: string | null
  sections: Sections
  notice: string | null
  now: number
  /** The test whose send waits for a second press: it has steps without a result. */
  confirming: string | null
}

/** The key a draft is kept under: the item, or one step of a test. */
export const draftKey = (id: string, stepId?: string) =>
  stepId === undefined ? id : `${id}:${stepId}`

const DONE_SHOWN = 20

export function renderPane(el: Elements, model: PaneModel, a: Actions, s: Strings) {
  const entry =
    model.selected === null
      ? undefined
      : model.entries.find(one => one.item.id === model.selected)

  return entry === undefined ? list(el, model, a, s) : detail(el, entry, model, a, s)
}

function meta(entry: Entry, now: number, s: Strings): string {
  const parts = [
    ...(entry.item.source.label === undefined ? [] : [s.from(entry.item.source.label)]),
    formatTime(entry.item.createdAt, now, s),
  ]

  return parts.join(' · ')
}

function row(el: Elements, entry: Entry, model: PaneModel, a: Actions, s: Strings) {
  const { Button, Text } = el
  const { item } = entry
  const mark = entry.status === 'open' ? (entry.isNew ? '● ' : '○ ') : '✓ '

  return (
    <Button key={`item-${item.id}`} plain onPress={() => a.select(item.id)}>
      {mark}
      {s.type[item.type]}: {item.title}{' '}
      <Text dimColor>
        {entry.isNew ? `${s.fresh} · ` : ''}
        {meta(entry, model.now, s)}
      </Text>
    </Button>
  )
}

function list(el: Elements, model: PaneModel, a: Actions, s: Strings) {
  const { Box, Text, Button } = el
  const open = model.entries.filter(one => one.status === 'open')
  const answered = model.entries.filter(one => one.status === 'answered')
  const done = model.entries.filter(one => one.status === 'done')
  const { open: openCount, fresh } = counts(model.entries)

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{s.header(openCount, fresh)}</Text>
      {model.notice !== null && <Text color="warning">{model.notice}</Text>}
      {open.length === 0 && <Text dimColor>{s.empty}</Text>}
      {groupByProject(open).map(group => (
        <Box key={`project-${group.project}`} flexDirection="column">
          <Text bold dimColor>
            {group.project}
          </Text>
          {group.entries.map(one => row(el, one, model, a, s))}
        </Box>
      ))}
      {answered.length > 0 && (
        <Box key="answered" flexDirection="column">
          <Button key="section-answered" plain onPress={() => a.toggle('answered')}>
            {model.sections.answered ? '▾ ' : '▸ '}
            {s.answeredSection(answered.length)}
          </Button>
          {model.sections.answered && answered.map(one => row(el, one, model, a, s))}
        </Box>
      )}
      {done.length > 0 && (
        <Box key="done" flexDirection="column">
          <Button key="section-done" plain onPress={() => a.toggle('done')}>
            {model.sections.done ? '▾ ' : '▸ '}
            {s.doneSection(done.length)}
          </Button>
          {model.sections.done &&
            done.slice(0, DONE_SHOWN).map(one => row(el, one, model, a, s))}
        </Box>
      )}
    </Box>
  )
}

function detail(el: Elements, entry: Entry, model: PaneModel, a: Actions, s: Strings) {
  const { Box, Text, Button, Markdown } = el
  const { item } = entry

  return (
    <Box flexDirection="column" gap={1}>
      <Button key="back" plain label={s.back} onPress={() => a.select(null)} />
      <Text dimColor>
        {s.type[item.type]} · {item.project} · {meta(entry, model.now, s)}
      </Text>
      <Text bold>{item.title}</Text>
      {item.body !== undefined && <Markdown key={`body-${item.id}`} text={item.body} />}
      {entry.status === 'open'
        ? controls(el, item, entry.response, model, a, s)
        : outcome(el, entry, a, s)}
      {model.notice !== null && <Text color="warning">{model.notice}</Text>}
      {entry.status === 'open' && (
        <Button key={`dismiss-${item.id}`} plain dimColor label={s.archive} onPress={() => a.archive(item.id)} />
      )}
    </Box>
  )
}

function noteInput(el: Elements, item: Item, a: Actions, s: Strings, label: string) {
  const { Input } = el

  return (
    <Input
      key={`note-${item.id}`}
      label={label}
      value={a.draftOf(draftKey(item.id)) ?? ''}
      onInput={(text: string) => a.draft(draftKey(item.id), text)}
      onSubmit={(text: string) => a.draft(draftKey(item.id), text)}
    />
  )
}

function controls(
  el: Elements,
  item: Item,
  response: Response | undefined,
  model: PaneModel,
  a: Actions,
  s: Strings,
) {
  const { Box, Button, Input } = el

  switch (item.type) {
    case 'question':
    case 'decision':
      return (
        <Box key={`answer-${item.id}`} flexDirection="column" gap={1}>
          {(item.options ?? []).map((option, index) => (
            <Button
              key={`option-${item.id}-${index}`}
              label={option === item.recommended ? `${option} (${s.recommended})` : option}
              variant={option === item.recommended ? 'primary' : 'secondary'}
              onPress={() => a.choose(item.id, option)}
            />
          ))}
          {item.allowText && (
            <Input
              key={`text-${item.id}`}
              label={item.options === undefined ? s.yourAnswer : s.ownAnswer}
              value={a.draftOf(draftKey(item.id)) ?? ''}
              submitLabel={s.send}
              onInput={(text: string) => a.draft(draftKey(item.id), text)}
              onSubmit={(text: string) => a.sendText(item.id, text)}
            />
          )}
        </Box>
      )
    case 'approval':
    case 'review':
    case 'task': {
      const [yes, no] =
        item.type === 'approval'
          ? [s.approve, s.reject]
          : item.type === 'review'
            ? [s.looked, s.notLooked]
            : [s.done, s.cannot]
      const [yesChoice, noChoice] =
        item.type === 'approval' ? ['approved', 'rejected'] : ['done', 'declined']

      return (
        <Box key={`answer-${item.id}`} flexDirection="column" gap={1}>
          {noteInput(el, item, a, s, s.note)}
          <Box flexDirection="row" gap={1}>
            <Button
              key={`yes-${item.id}`}
              label={yes}
              variant="primary"
              onPress={() => a.choose(item.id, yesChoice)}
            />
            <Button key={`no-${item.id}`} label={no} onPress={() => a.choose(item.id, noChoice)} />
          </Box>
        </Box>
      )
    }
    case 'test':
      return testControls(el, item, response, model.confirming === item.id, a, s)
  }
}

function testControls(
  el: Elements,
  item: Item,
  response: Response | undefined,
  confirming: boolean,
  a: Actions,
  s: Strings,
) {
  const { Box, Text, Button, Input, Markdown } = el
  const results = response?.steps ?? {}
  const steps = item.steps ?? []
  const marked = steps.filter(step => results[step.id]?.result !== undefined).length

  return (
    <Box key={`answer-${item.id}`} flexDirection="column" gap={1}>
      {steps.map(step => {
        const result = results[step.id]?.result
        const key = draftKey(item.id, step.id)
        const saved = results[step.id]?.note
        const draft = a.draftOf(key)
        const isSaved = saved !== undefined && (draft === undefined || draft.trim() === saved)

        return (
          <Box key={`step-${item.id}-${step.id}`} flexDirection="column">
            <Text bold>
              {result === 'pass' ? '✓ ' : result === 'fail' ? '✗ ' : '○ '}
              {step.id}.
            </Text>
            <Markdown key={`step-text-${item.id}-${step.id}`} text={step.text} />
            {step.expect !== undefined && (
              <Text dimColor>
                {s.expected}: {step.expect}
              </Text>
            )}
            <Box flexDirection="row" gap={1}>
              <Button
                key={`pass-${item.id}-${step.id}`}
                label={s.pass}
                variant={result === 'pass' ? 'primary' : 'secondary'}
                onPress={() => a.mark(item.id, step.id, 'pass')}
              />
              <Button
                key={`fail-${item.id}-${step.id}`}
                label={s.fail}
                variant={result === 'fail' ? 'primary' : 'secondary'}
                onPress={() => a.mark(item.id, step.id, 'fail')}
              />
            </Box>
            <Input
              key={`step-note-${item.id}-${step.id}`}
              label={s.stepNote}
              value={draft ?? saved ?? ''}
              submitLabel={s.save}
              onInput={(text: string) => a.draft(key, text)}
              onSubmit={(text: string) => a.saveStepNote(item.id, step.id, text)}
            />
            {isSaved && <Text dimColor>{s.noteSaved}</Text>}
          </Box>
        )
      })}
      {noteInput(el, item, a, s, s.overallNote)}
      <Button
        key={`send-${item.id}`}
        label={confirming ? s.sendAnyway(marked, steps.length) : s.sendResult(marked, steps.length)}
        variant="primary"
        onPress={() => a.sendTest(item.id)}
      />
    </Box>
  )
}

/** The owner's own answer, in the owner's language. */
export function ownerSummary(item: Item, response: Response, s: Strings): string[] {
  const note = response.text === undefined ? [] : [`${s.note.replace(/ \(.*\)$/, '')}: ${response.text}`]
  switch (item.type) {
    case 'question':
    case 'decision':
      return response.choice !== undefined
        ? [response.choice, ...note]
        : [response.text ?? '']
    case 'approval':
      return [response.choice === 'approved' ? s.approve : s.reject, ...note]
    case 'review':
      return [response.choice === 'declined' ? s.notLooked : s.looked, ...note]
    case 'task':
      return [response.choice === 'declined' ? s.cannot : s.done, ...note]
    case 'test': {
      const results: Readonly<Record<string, StepResult>> = response.steps ?? {}

      return [
        ...(item.steps ?? []).map(step => {
          const got = results[step.id]
          const mark = got?.result === 'pass' ? '✓' : got?.result === 'fail' ? '✗' : '○'

          return `${mark} ${step.id}. ${step.text.split('\n')[0] ?? ''}${got?.note === undefined ? '' : ` — ${got.note}`}`
        }),
        ...note,
      ]
    }
  }
}

function outcome(el: Elements, entry: Entry, a: Actions, s: Strings) {
  const { Box, Text, Button } = el
  const { item, response } = entry
  const isAnswered = response?.status === 'answered'
  const state =
    item.closed !== undefined
      ? item.closed.reason === 'withdrawn'
        ? s.withdrawn
        : s.closed
      : entry.delivered
        ? s.delivered
        : s.waiting

  return (
    <Box key={`outcome-${item.id}`} flexDirection="column" gap={1}>
      {isAnswered && response !== undefined && (
        <Box flexDirection="column">
          <Text bold>{s.yourAnswer}:</Text>
          {ownerSummary(item, response, s).map(line => (
            <Text>{line}</Text>
          ))}
        </Box>
      )}
      <Text dimColor>{state}</Text>
      {item.closed === undefined && (
        <Box flexDirection="row" gap={1}>
          {isAnswered && (
            <Button key={`undo-${item.id}`} label={s.undo} onPress={() => a.undo(item.id)} />
          )}
          {response?.archived !== true && (
            <Button key={`archive-${item.id}`} label={s.archive} onPress={() => a.archive(item.id)} />
          )}
        </Box>
      )}
    </Box>
  )
}
