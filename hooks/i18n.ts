// The owner's side of the inbox follows the system language (German or
// English); `language` in the plugin's options fixes one. What the model reads
// stays English.
import type { ItemType } from '../types'

export type Language = 'de' | 'en'

export type Strings = {
  paneTitle: (open: number) => string
  band: (open: number, fresh: number) => string
  header: (open: number, fresh: number) => string
  empty: string
  type: Record<ItemType, string>
  fresh: string
  back: string
  answeredSection: (n: number) => string
  doneSection: (n: number) => string
  from: (label: string) => string
  recommended: string
  ownAnswer: string
  note: string
  send: string
  approve: string
  reject: string
  done: string
  looked: string
  cannot: string
  notLooked: string
  pass: string
  fail: string
  stepNote: string
  save: string
  sendResult: (marked: number, total: number) => string
  sendAnyway: (marked: number, total: number) => string
  unmarked: (steps: readonly string[]) => string
  overallNote: string
  yourAnswer: string
  waiting: string
  delivered: string
  closed: string
  withdrawn: string
  undo: string
  archive: string
  secretWarning: string
  needAnswer: string
  needMark: string
  expected: string
  notifyTitle: string
  commandDescription: string
  commandOpened: string
  noteSaved: string
  months: readonly string[]
}

const de: Strings = {
  paneTitle: open => (open > 0 ? `Für dich (${open})` : 'Für dich'),
  band: (open, fresh) =>
    `Für dich: ${open} offen${fresh > 0 ? `, ${fresh} neu` : ''}`,
  header: (open, fresh) =>
    open === 0
      ? 'Nichts offen.'
      : `${open} offen${fresh > 0 ? `, davon ${fresh} neu` : ''}`,
  empty: 'Gerade wartet nichts auf dich.',
  type: {
    question: 'Frage',
    decision: 'Entscheidung',
    approval: 'Freigabe',
    review: 'Anschauen',
    task: 'Aufgabe',
    test: 'Test',
  },
  fresh: 'neu',
  back: '← Zurück',
  answeredSection: n => `Beantwortet (${n})`,
  doneSection: n => `Erledigt (${n})`,
  from: label => `von ${label}`,
  recommended: 'empfohlen',
  ownAnswer: 'Eigene Antwort',
  note: 'Notiz (optional, geht beim Senden mit)',
  send: 'Senden',
  approve: 'Freigeben',
  reject: 'Ablehnen',
  done: 'Erledigt',
  looked: 'Angesehen',
  cannot: 'Geht nicht',
  notLooked: 'Nicht angesehen',
  pass: '✓ Wie erwartet',
  fail: '✗ Nicht wie erwartet',
  stepNote: 'Notiz zu diesem Schritt (Enter speichert)',
  save: 'Speichern',
  sendResult: (marked, total) => `Ergebnis senden (${marked} von ${total} geprüft)`,
  sendAnyway: (marked, total) => `Trotzdem senden (${marked} von ${total} geprüft)`,
  unmarked: steps =>
    steps.length === 1
      ? `Schritt ${steps[0]} hat noch kein Ergebnis. Drück noch einmal auf „Trotzdem senden“, um so zu senden.`
      : `Die Schritte ${steps.join(', ')} haben noch kein Ergebnis. Drück noch einmal auf „Trotzdem senden“, um so zu senden.`,
  overallNote: 'Gesamtnotiz (optional)',
  yourAnswer: 'Deine Antwort',
  waiting: 'Bei der Sitzung noch nicht angekommen.',
  delivered: 'Bei der Sitzung angekommen.',
  closed: 'Erledigt.',
  withdrawn: 'Von der Sitzung zurückgezogen.',
  undo: 'Antwort zurücknehmen',
  archive: 'Ausblenden',
  secretWarning:
    'Das sieht nach einem Passwort oder Schlüssel aus. Nicht gesendet: so etwas gehört nicht in den Posteingang.',
  needAnswer: 'Bitte erst eine Antwort eintippen.',
  needMark: 'Bitte mindestens einen Schritt als „Wie erwartet“ oder „Nicht wie erwartet“ markieren.',
  expected: 'Erwartet',
  notifyTitle: 'Neu für dich',
  commandDescription: 'Öffnet den Posteingang „Für dich“ neben dem Chat',
  commandOpened: 'Posteingang geöffnet.',
  noteSaved: '✓ Notiz gespeichert',
  months: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
}

const en: Strings = {
  paneTitle: open => (open > 0 ? `For you (${open})` : 'For you'),
  band: (open, fresh) => `For you: ${open} open${fresh > 0 ? `, ${fresh} new` : ''}`,
  header: (open, fresh) =>
    open === 0 ? 'Nothing open.' : `${open} open${fresh > 0 ? `, ${fresh} new` : ''}`,
  empty: 'Nothing is waiting for you.',
  type: {
    question: 'Question',
    decision: 'Decision',
    approval: 'Approval',
    review: 'Look at',
    task: 'Task',
    test: 'Test',
  },
  fresh: 'new',
  back: '← Back',
  answeredSection: n => `Answered (${n})`,
  doneSection: n => `Done (${n})`,
  from: label => `from ${label}`,
  recommended: 'recommended',
  ownAnswer: 'Your own answer',
  note: 'Note (optional, sent with your answer)',
  send: 'Send',
  approve: 'Approve',
  reject: 'Reject',
  done: 'Done',
  looked: 'Looked at it',
  cannot: 'Cannot do it',
  notLooked: 'Did not look',
  pass: '✓ As expected',
  fail: '✗ Not as expected',
  stepNote: 'Note on this step (Enter saves)',
  save: 'Save',
  sendResult: (marked, total) => `Send result (${marked} of ${total} checked)`,
  sendAnyway: (marked, total) => `Send anyway (${marked} of ${total} checked)`,
  unmarked: steps =>
    steps.length === 1
      ? `Step ${steps[0]} has no result yet. Press "Send anyway" again to send it like this.`
      : `Steps ${steps.join(', ')} have no result yet. Press "Send anyway" again to send them like this.`,
  overallNote: 'Overall note (optional)',
  yourAnswer: 'Your answer',
  waiting: 'Not yet received by the session.',
  delivered: 'Received by the session.',
  closed: 'Done.',
  withdrawn: 'Withdrawn by the session.',
  undo: 'Take answer back',
  archive: 'Put away',
  secretWarning:
    'That looks like a password or key. Not sent: such things do not belong in the inbox.',
  needAnswer: 'Type an answer first.',
  needMark: 'Mark at least one step as expected or not as expected.',
  expected: 'Expected',
  notifyTitle: 'New for you',
  commandDescription: 'Opens the "For you" inbox beside the chat',
  commandOpened: 'Inbox opened.',
  noteSaved: '✓ Note saved',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}

/**
 * The owner's language: `de` or `en` as set, else (`auto`, the default) the
 * system's, German for a German locale and English for every other.
 */
export function strings(language: unknown, locale: string | undefined): Strings {
  if (language === 'de') return de
  if (language === 'en') return en

  return locale?.toLowerCase().startsWith('de') === true ? de : en
}

/** "15:30" today, "17. Nov 15:30" (or "Nov 17 15:30") otherwise. */
export function formatTime(at: number, now: number, s: Strings): string {
  const d = new Date(at)
  const today = new Date(now)
  const two = (n: number) => String(n).padStart(2, '0')
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  if (sameDay) return time
  const month = s.months[d.getMonth()] ?? ''

  return s === en ? `${month} ${d.getDate()} ${time}` : `${d.getDate()}. ${month} ${time}`
}
