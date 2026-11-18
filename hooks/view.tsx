// The pane beside the chat: the list of what waits for the owner, grouped by
// project, and one item opened with the buttons that answer it. It draws from
// a model and calls actions; it reads and writes nothing itself.
import type { Entry, Item, ItemType, Phase, Response, Sections, Shelf, StepResult } from '../types'
import { counts, groupByProject, isPending } from './core'
import { formatTime, type Strings } from './i18n'
import { ICON_GLYPH, iconSvg } from './icons'

/** The elements a surface's table holds that the pane uses. */
// biome-ignore lint/suspicious/noExplicitAny: each surface's table has its own constructor types
export type Elements = { Box: any; Text: any; Button: any; Input: any; Markdown: any; Svg?: any }

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
  /** Moves every done item to the archive, or done or archived items out of the pane. */
  shelve: (from: 'done' | 'archive', to: Shelf) => void
}

export type PaneModel = {
  entries: readonly Entry[]
  selected: string | null
  sections: Sections
  notice: string | null
  now: number
  /** The test whose send waits for a second press: it has steps without a result. */
  confirming: string | null
  /** The part whose clearing waits for a second press. */
  confirmingClear: 'done' | 'archive' | null
  /** Whether the surface draws SVG; the terminal draws an empty box in its place. */
  drawsSvg: boolean
}

/** The key a draft is kept under: the item, or one step of a test. */
export const draftKey = (id: string, stepId?: string) =>
  stepId === undefined ? id : `${id}:${stepId}`

/** The key the note to the session about a phase is drafted under. */
export const phaseKey = (id: string) => `${id}:phase`

/** Whether a section is expanded: in progress and later are, unless closed; done and the archive once opened. */
const isOpen = (sections: Sections, key: keyof Sections) =>
  key === 'done' || key === 'archive' ? sections[key] === true : sections[key] !== false

const DONE_SHOWN = 20

// The look follows the app's own panels: plain rows, thin rules between the
// parts, color only where it must catch the eye (what is open, and what is
// new). Each part keeps its symbol; each type of item has an icon.
type Part = 'open' | keyof Sections

const SYMBOL: Record<Part, string> = {
  open: '●',
  progress: '▶',
  later: '⏸',
  done: '✓',
  archive: '▤',
}

const OPEN_COLOR = 'error'

/** A type's icon: a line drawing where the surface draws SVG, a glyph on the terminal. */
function icon(el: Elements, type: ItemType, model: PaneModel, s: Strings) {
  const { Svg, Text } = el
  if (!model.drawsSvg || Svg === undefined) return <Text dimColor>{ICON_GLYPH[type]}</Text>

  return <Svg source={iconSvg(type)} alt={s.type[type]} width={16} height={16} />
}

const isFinished = (entry: Entry) => entry.status === 'answered' || entry.status === 'done'

export function renderPane(el: Elements, model: PaneModel, a: Actions, s: Strings) {
  const entry =
    model.selected === null
      ? undefined
      : model.entries.find(one => one.item.id === model.selected)

  return entry === undefined ? list(el, model, a, s) : detail(el, entry, model, a, s)
}

/** A thin rule between parts, as the app's own panels have. */
function rule(el: Elements, key: string) {
  const { Markdown } = el

  return <Markdown key={`rule-${key}`} text="---" />
}

/** Who filed it and how: the session's name, taken from chat. */
function origin(entry: Entry, s: Strings): string[] {
  return [
    ...(entry.item.source.label === undefined ? [] : [s.from(entry.item.source.label)]),
    ...(entry.item.captured === true ? [s.captured] : []),
  ]
}

/** One item in the list: icon, title and age, and below what it is and where from. */
function row(el: Elements, entry: Entry, model: PaneModel, a: Actions, s: Strings) {
  const { Box, Button, Text } = el
  const { item } = entry
  const isFresh = entry.status === 'open' && entry.isNew
  const details = [s.type[item.type], item.project, ...origin(entry, s)].join(' · ')

  return (
    <Box key={`card-${item.id}`} flexDirection="row" gap="md">
      {icon(el, item.type, model, s)}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} gap="xs">
        <Box flexDirection="row" justifyContent="space-between" gap="sm">
          <Button key={`item-${item.id}`} plain onPress={() => a.select(item.id)}>
            <Text weight="semibold" dimColor={isFinished(entry)}>
              {item.title}
            </Text>
          </Button>
          <Text size="footnote" dimColor>
            {formatTime(item.createdAt, model.now, s)}
          </Text>
        </Box>
        <Box flexDirection="row" gap="sm">
          {isFresh && (
            <Text size="footnote" color={OPEN_COLOR} weight="semibold">
              ● {s.fresh}
            </Text>
          )}
          <Text size="footnote" dimColor>
            {details}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

/** A part's heading; open's in color, the others fold. */
function heading(el: Elements, part: Part, title: string, model: PaneModel, a: Actions) {
  const { Box, Button, Text } = el
  if (part === 'open') {
    return (
      <Box key="heading-open" flexDirection="row" gap="sm">
        <Text weight="bold" color={OPEN_COLOR}>
          {SYMBOL.open}
        </Text>
        <Text weight="bold" color={OPEN_COLOR}>
          {title}
        </Text>
      </Box>
    )
  }
  const expanded = isOpen(model.sections, part)

  return (
    <Button key={`section-${part}`} plain onPress={() => a.toggle(part)}>
      <Text weight="bold">
        {SYMBOL[part]} {title}
      </Text>
      <Text dimColor>{expanded ? ' ▾' : ' ▸'}</Text>
    </Button>
  )
}

/** What is done can go to the archive or out of the pane; the archive can be emptied. */
function shelfButtons(el: Elements, part: 'done' | 'archive', count: number, model: PaneModel, a: Actions, s: Strings) {
  const { Box, Button } = el
  const confirming = model.confirmingClear === part

  return (
    <Box key={`shelf-${part}`} flexDirection="row" flexWrap="wrap" gap="sm">
      {part === 'done' && <Button key="archive-done" label={s.archiveAll} onPress={() => a.shelve('done', 'archive')} />}
      <Button
        key={`clear-${part}`}
        label={confirming ? s.confirmClear(count) : part === 'done' ? s.clearAll : s.clearArchive}
        variant={confirming ? 'primary' : 'secondary'}
        onPress={() => a.shelve(part, 'cleared')}
      />
    </Box>
  )
}

function section(
  el: Elements,
  part: keyof Sections,
  title: string,
  entries: readonly Entry[],
  model: PaneModel,
  a: Actions,
  s: Strings,
) {
  const { Box } = el
  if (entries.length === 0) return null
  const expanded = isOpen(model.sections, part)
  const shown = part === 'done' || part === 'archive' ? entries.slice(0, DONE_SHOWN) : entries

  return (
    <Box key={part} flexDirection="column" gap="md">
      {rule(el, part)}
      {heading(el, part, title, model, a)}
      {expanded && shown.map(one => row(el, one, model, a, s))}
      {expanded && (part === 'done' || part === 'archive') && shelfButtons(el, part, entries.length, model, a, s)}
    </Box>
  )
}

function list(el: Elements, model: PaneModel, a: Actions, s: Strings) {
  const { Box, Text } = el
  const open = model.entries.filter(one => one.status === 'open')
  const progress = model.entries.filter(one => one.status === 'progress')
  const later = model.entries.filter(one => one.status === 'later')
  // Answered is done from the owner's side: the session takes it from there.
  const finished = model.entries.filter(isFinished)
  const done = finished.filter(one => one.response?.shelf === undefined)
  const archived = finished.filter(one => one.response?.shelf === 'archive')
  const { open: openCount, fresh } = counts(model.entries)

  return (
    <Box flexDirection="column" gap="lg" paddingX="sm" paddingY="md">
      {model.notice !== null && <Text color="warning">{model.notice}</Text>}
      <Box key="open" flexDirection="column" gap="md">
        {heading(el, 'open', s.header(openCount, fresh), model, a)}
        {open.length + progress.length + later.length === 0 && <Text dimColor>{s.empty}</Text>}
        {groupByProject(open)
          .flatMap(group => group.entries)
          .map(one => row(el, one, model, a, s))}
      </Box>
      {section(el, 'progress', s.progressSection(progress.length), progress, model, a, s)}
      {section(el, 'later', s.laterSection(later.length), later, model, a, s)}
      {section(el, 'done', s.doneSection(done.length), done, model, a, s)}
      {section(el, 'archive', s.archiveSection(archived.length), archived, model, a, s)}
    </Box>
  )
}

function detail(el: Elements, entry: Entry, model: PaneModel, a: Actions, s: Strings) {
  const { Box, Text, Button, Markdown } = el
  const { item } = entry
  const pending = isPending(entry.status)
  const byline = [...origin(entry, s), formatTime(item.createdAt, model.now, s)].join(' · ')

  return (
    <Box flexDirection="column" gap="lg" paddingX="sm" paddingY="md">
      <Button key="back" plain label={s.back} onPress={() => a.select(null)} />
      <Box key={`head-${item.id}`} flexDirection="column" gap="sm">
        <Box flexDirection="row" gap="sm" alignItems="center">
          {icon(el, item.type, model, s)}
          <Text size="footnote" dimColor>
            {s.type[item.type]} · {item.project}
          </Text>
        </Box>
        <Text size="title" weight="bold">
          {item.title}
        </Text>
        <Text size="footnote" dimColor>
          {byline}
        </Text>
      </Box>
      {item.body !== undefined && rule(el, `body-${item.id}`)}
      {item.body !== undefined && <Markdown key={`body-${item.id}`} text={item.body} />}
      {pending && phaseState(el, entry, model, s)}
      {rule(el, `answer-${item.id}`)}
      {pending ? (
        <Box key={`answer-box-${item.id}`} flexDirection="column" gap="md">
          <Text weight="bold">{s.yourAnswer}</Text>
          {controls(el, item, entry.response, model, a, s)}
        </Box>
      ) : (
        outcome(el, entry, a, s)
      )}
      {model.notice !== null && <Text color="warning">{model.notice}</Text>}
      {pending && rule(el, `phase-${item.id}`)}
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

  return (
    <Box key={`phase-${entry.item.id}`} flexDirection="column" gap="xs">
      <Box flexDirection="row" gap="sm">
        <Text>{SYMBOL[response.phase]}</Text>
        <Text>{s.phaseState(response.phase, formatTime(response.phaseAt, model.now, s))}</Text>
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
      {steps.map((step, index) => {
        const result = results[step.id]?.result
        const key = draftKey(item.id, step.id)
        const saved = results[step.id]?.note
        const draft = a.draftOf(key)
        const isSaved = saved !== undefined && (draft === undefined || draft.trim() === saved)

        return (
          <Box key={`step-${item.id}-${step.id}`} flexDirection="column" gap="sm">
            {index > 0 && rule(el, `step-${item.id}-${step.id}`)}
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
        <Box flexDirection="column" gap="xs">
          <Text weight="bold">{s.yourAnswer}:</Text>
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
