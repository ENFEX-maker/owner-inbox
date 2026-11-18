// The pane beside the chat: the list of what waits for the owner, grouped by
// project, and one item opened with the buttons that answer it. It draws from
// a model and calls actions; it reads and writes nothing itself.
import type { Entry, Item, ItemType, Phase, Response, Sections, StepResult } from '../types'
import { counts, groupByProject, isPending } from './core'
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
  /** Files an item as being worked on or put off, or (null) back to active, with the drafted note. */
  setPhase: (id: string, phase: Phase | null) => void
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

/** The key the note to the session about a phase is drafted under. */
export const phaseKey = (id: string) => `${id}:phase`

/** Whether a section is expanded: in progress and later are, unless closed. */
const isOpen = (sections: Sections, key: keyof Sections) =>
  key === 'done' ? sections.done === true : sections[key] !== false

const DONE_SHOWN = 20

// The look: each section has one symbol and one color, used for its heading,
// its cards' borders and the item's own page; each type of item one icon.
type Look = { icon: string; color: string }

const LOOK: Record<'open' | keyof Sections, Look> = {
  open: { icon: '●', color: 'claude' },
  progress: { icon: '▶', color: 'suggestion' },
  later: { icon: '⏸', color: 'warning' },
  done: { icon: '✓', color: 'success' },
}

const TYPE_ICON: Record<ItemType, string> = {
  question: '💬',
  decision: '🧭',
  approval: '👍',
  review: '👀',
  task: '📌',
  test: '🧪',
}

function lookOf(status: Entry['status']): Look {
  return status === 'open' || status === 'progress' || status === 'later' ? LOOK[status] : LOOK.done
}

export function renderPane(el: Elements, model: PaneModel, a: Actions, s: Strings) {
  const entry =
    model.selected === null
      ? undefined
      : model.entries.find(one => one.item.id === model.selected)

  return entry === undefined ? list(el, model, a, s) : detail(el, entry, model, a, s)
}

/** Who filed it and how, below the title: the session's name, taken from chat. */
function origin(entry: Entry, s: Strings): string {
  return [
    ...(entry.item.source.label === undefined ? [] : [s.from(entry.item.source.label)]),
    ...(entry.item.captured === true ? [s.captured] : []),
  ].join(' · ')
}

/** The line above a title: icon, type and project. */
function kind(item: Item, s: Strings): string {
  return `${TYPE_ICON[item.type]} ${s.type[item.type]} · ${item.project}`
}

/** One item in the list: a card with its kind and age, the title, and who filed it. */
function card(el: Elements, entry: Entry, model: PaneModel, a: Actions, s: Strings) {
  const { Box, Button, Text } = el
  const { item } = entry
  const look = lookOf(entry.status)
  const isFresh = entry.status === 'open' && entry.isNew
  const isDone = entry.status === 'answered' || entry.status === 'done'
  const from = origin(entry, s)

  return (
    <Box
      key={`card-${item.id}`}
      flexDirection="column"
      gap="xs"
      paddingX="md"
      paddingY="sm"
      borderStyle="round"
      borderColor={look.color}
      borderDimColor={!isFresh}
    >
      <Box flexDirection="row" justifyContent="space-between" gap="sm">
        <Text size="footnote" dimColor>
          {kind(item, s)}
        </Text>
        <Text size="footnote" dimColor>
          {formatTime(item.createdAt, model.now, s)}
        </Text>
      </Box>
      <Button key={`item-${item.id}`} plain onPress={() => a.select(item.id)}>
        <Text weight="semibold" dimColor={isDone}>
          {item.title}
        </Text>
      </Button>
      {(isFresh || from !== '') && (
        <Box flexDirection="row" gap="sm">
          {isFresh && (
            <Text size="footnote" color={look.color} weight="semibold">
              {look.icon} {s.fresh}
            </Text>
          )}
          {from !== '' && (
            <Text size="footnote" dimColor>
              {from}
            </Text>
          )}
        </Box>
      )}
    </Box>
  )
}

/** A heading in a section's color; a press folds the section where it folds. */
function heading(el: Elements, key: 'open' | keyof Sections, title: string, model: PaneModel, a: Actions) {
  const { Box, Button, Text } = el
  const look = LOOK[key]
  if (key === 'open') {
    return (
      <Box key="heading-open" flexDirection="row" gap="sm">
        <Text size="heading" weight="bold" color={look.color}>
          {look.icon}
        </Text>
        <Text size="heading" weight="bold" color={look.color}>
          {title}
        </Text>
      </Box>
    )
  }
  const expanded = isOpen(model.sections, key)

  return (
    <Button key={`section-${key}`} plain onPress={() => a.toggle(key)}>
      <Text size="heading" weight="bold" color={look.color}>
        {look.icon} {title}
      </Text>
      <Text dimColor>{expanded ? ' ▾' : ' ▸'}</Text>
    </Button>
  )
}

function section(
  el: Elements,
  key: keyof Sections,
  title: string,
  entries: readonly Entry[],
  model: PaneModel,
  a: Actions,
  s: Strings,
) {
  const { Box } = el
  if (entries.length === 0) return null
  const expanded = isOpen(model.sections, key)
  const shown = key === 'done' ? entries.slice(0, DONE_SHOWN) : entries

  return (
    <Box key={key} flexDirection="column" gap="md">
      {heading(el, key, title, model, a)}
      {expanded && shown.map(one => card(el, one, model, a, s))}
    </Box>
  )
}

function list(el: Elements, model: PaneModel, a: Actions, s: Strings) {
  const { Box, Text } = el
  const open = model.entries.filter(one => one.status === 'open')
  const progress = model.entries.filter(one => one.status === 'progress')
  const later = model.entries.filter(one => one.status === 'later')
  // Answered is done from the owner's side: the session takes it from there.
  const done = model.entries.filter(one => one.status === 'answered' || one.status === 'done')
  const { open: openCount, fresh } = counts(model.entries)

  return (
    <Box flexDirection="column" gap="xl" paddingX="sm" paddingY="md">
      {model.notice !== null && <Text color="warning">{model.notice}</Text>}
      <Box key="open" flexDirection="column" gap="md">
        {heading(el, 'open', s.header(openCount, fresh), model, a)}
        {open.length + progress.length + later.length === 0 && <Text dimColor>{s.empty}</Text>}
        {groupByProject(open)
          .flatMap(group => group.entries)
          .map(one => card(el, one, model, a, s))}
      </Box>
      {section(el, 'progress', s.progressSection(progress.length), progress, model, a, s)}
      {section(el, 'later', s.laterSection(later.length), later, model, a, s)}
      {section(el, 'done', s.doneSection(done.length), done, model, a, s)}
    </Box>
  )
}

function detail(el: Elements, entry: Entry, model: PaneModel, a: Actions, s: Strings) {
  const { Box, Text, Button, Markdown } = el
  const { item } = entry
  const look = lookOf(entry.status)
  const from = origin(entry, s)
  const pending = isPending(entry.status)

  return (
    <Box flexDirection="column" gap="xl" paddingX="sm" paddingY="md">
      <Button key="back" plain label={s.back} onPress={() => a.select(null)} />
      <Box key={`head-${item.id}`} flexDirection="column" gap="sm">
        <Text size="footnote" color={look.color}>
          {look.icon} {kind(item, s)}
        </Text>
        <Text size="title" weight="bold">
          {item.title}
        </Text>
        <Text size="footnote" dimColor>
          {[from, formatTime(item.createdAt, model.now, s)].filter(part => part !== '').join(' · ')}
        </Text>
      </Box>
      {item.body !== undefined && <Markdown key={`body-${item.id}`} text={item.body} />}
      {pending && phaseState(el, entry, model, s)}
      {pending ? (
        <Box
          key={`answer-box-${item.id}`}
          flexDirection="column"
          gap="md"
          paddingX="md"
          paddingY="md"
          borderStyle="round"
          borderColor={look.color}
        >
          <Text weight="bold" color={look.color}>
            {s.yourAnswer}
          </Text>
          {controls(el, item, entry.response, model, a, s)}
        </Box>
      ) : (
        outcome(el, entry, a, s)
      )}
      {model.notice !== null && <Text color="warning">{model.notice}</Text>}
      {pending && phaseControls(el, entry, a, s)}
      {pending && (
        <Button key={`dismiss-${item.id}`} plain dimColor label={s.archive} onPress={() => a.archive(item.id)} />
      )}
    </Box>
  )
}

/** Where the owner filed the item, and the note they sent with it. */
function phaseState(el: Elements, entry: Entry, model: PaneModel, s: Strings) {
  const { Box, Text } = el
  const response = entry.response
  if (response?.phase === undefined || response.phaseAt === undefined) return null
  const look = LOOK[response.phase]

  return (
    <Box key={`phase-${entry.item.id}`} flexDirection="column" gap="xs">
      <Box flexDirection="row" gap="sm">
        <Text color={look.color}>{look.icon}</Text>
        <Text color={look.color}>{s.phaseState(response.phase, formatTime(response.phaseAt, model.now, s))}</Text>
      </Box>
      {response.phaseNote !== undefined && (
        <Text dimColor>
          {s.yourNote}: {response.phaseNote}
        </Text>
      )}
    </Box>
  )
}

/** Files the item as in progress, later, or active again, with a note to the session. */
function phaseControls(el: Elements, entry: Entry, a: Actions, s: Strings) {
  const { Box, Text, Button, Input } = el
  const { item } = entry
  const key = phaseKey(item.id)

  return (
    <Box key={`phase-controls-${item.id}`} flexDirection="column" gap="md">
      <Text weight="semibold" dimColor>
        {s.phaseHeading}
      </Text>
      <Input
        key={`phase-note-${item.id}`}
        label={s.phaseNote}
        value={a.draftOf(key) ?? ''}
        onInput={(text: string) => a.draft(key, text)}
        onSubmit={(text: string) => a.draft(key, text)}
      />
      <Box flexDirection="row" flexWrap="wrap" gap="sm">
        {entry.status !== 'progress' && (
          <Button key={`progress-${item.id}`} label={s.toProgress} onPress={() => a.setPhase(item.id, 'progress')} />
        )}
        {entry.status !== 'later' && (
          <Button key={`later-${item.id}`} label={s.toLater} onPress={() => a.setPhase(item.id, 'later')} />
        )}
        {entry.status !== 'open' && (
          <Button key={`active-${item.id}`} label={s.toActive} onPress={() => a.setPhase(item.id, null)} />
        )}
      </Box>
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
        <Box key={`answer-${item.id}`} flexDirection="column" gap="sm">
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
        <Box key={`answer-${item.id}`} flexDirection="column" gap="md">
          {noteInput(el, item, a, s, s.note)}
          <Box flexDirection="row" flexWrap="wrap" gap="sm">
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
    <Box key={`answer-${item.id}`} flexDirection="column" gap="md">
      {steps.map(step => {
        const result = results[step.id]?.result
        const key = draftKey(item.id, step.id)
        const saved = results[step.id]?.note
        const draft = a.draftOf(key)
        const isSaved = saved !== undefined && (draft === undefined || draft.trim() === saved)

        return (
          <Box
            key={`step-${item.id}-${step.id}`}
            flexDirection="column"
            gap="sm"
            paddingX="md"
            paddingY="sm"
            borderStyle="round"
            borderColor={result === 'pass' ? 'success' : result === 'fail' ? 'error' : 'subtle'}
            borderDimColor={result === undefined}
          >
            <Text
              weight="bold"
              color={result === 'pass' ? 'success' : result === 'fail' ? 'error' : undefined}
            >
              {result === 'pass' ? '✓ ' : result === 'fail' ? '✗ ' : '○ '}
              {step.id}.
            </Text>
            <Markdown key={`step-text-${item.id}-${step.id}`} text={step.text} />
            {step.expect !== undefined && (
              <Text dimColor>
                {s.expected}: {step.expect}
              </Text>
            )}
            <Box flexDirection="row" flexWrap="wrap" gap="sm">
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
            {isSaved && <Text color="success">{s.noteSaved}</Text>}
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
        : item.closed.reason === 'chat'
          ? s.answeredInChat
          : s.closed
      : entry.delivered
        ? s.delivered
        : s.waiting

  return (
    <Box key={`outcome-${item.id}`} flexDirection="column" gap="md">
      {isAnswered && response !== undefined && (
        <Box
          flexDirection="column"
          gap="xs"
          paddingX="md"
          paddingY="sm"
          borderStyle="round"
          borderColor="success"
          borderDimColor
        >
          <Text weight="bold" color="success">
            {s.yourAnswer}:
          </Text>
          {ownerSummary(item, response, s).map(line => (
            <Text>{line}</Text>
          ))}
        </Box>
      )}
      <Text dimColor>{state}</Text>
      {item.closed === undefined && (
        <Box flexDirection="row" flexWrap="wrap" gap="sm">
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
