// The owner's side of the inbox speaks the system language when it knows it,
// English otherwise; `language` in the plugin's options fixes one. What the
// model reads stays English. Each language is one file under lang/; adding one
// is described in the README.
import type { ItemType } from '../types'
import { de } from './lang/de'
import { en } from './lang/en'
import { es } from './lang/es'
import { fr } from './lang/fr'
import { it } from './lang/it'
import { ja } from './lang/ja'
import { ko } from './lang/ko'
import { nl } from './lang/nl'
import { pl } from './lang/pl'
import { pt } from './lang/pt'
import { zh } from './lang/zh'

export type Strings = {
  paneTitle: (open: number) => string
  band: (open: number, fresh: number, progress: number) => string
  /** The count of items put off, shown apart at the band's right edge. */
  bandLater: (later: number) => string
  header: (open: number, fresh: number) => string
  empty: string
  progressSection: (n: number) => string
  laterSection: (n: number) => string
  phaseHeading: string
  phaseNote: string
  toProgress: string
  toLater: string
  toActive: string
  phaseState: (phase: 'progress' | 'later', time: string) => string
  yourNote: string
  type: Record<ItemType, string>
  fresh: string
  back: string
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
  /** The state of a captured item the owner answered in the chat. */
  answeredInChat: string
  /** Marks an item taken from a session's chat message. */
  captured: string
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
  /** Twelve short month names, January first. */
  months: readonly string[]
  /** A date not today: day of month, short month name, time "15:30". */
  day: (day: number, month: string, time: string) => string
}

/** Every language the pane speaks, by its ISO 639-1 code. */
export const LANGUAGES = { de, en, es, fr, it, ja, ko, nl, pl, pt, zh } as const satisfies Record<string, Strings>

export type Language = keyof typeof LANGUAGES

const isLanguage = (code: unknown): code is Language =>
  typeof code === 'string' && Object.hasOwn(LANGUAGES, code)

/**
 * The owner's language: the one set in the options, else (`auto`, the
 * default) the system's when the pane speaks it, else English.
 */
export function strings(language: unknown, locale: string | undefined): Strings {
  if (isLanguage(language)) return LANGUAGES[language]
  const code = locale?.toLowerCase().split(/[-_]/)[0]

  return isLanguage(code) ? LANGUAGES[code] : en
}

/** "15:30" today, else the day in the language's own order, as "17. Nov 15:30". */
export function formatTime(at: number, now: number, s: Strings): string {
  const d = new Date(at)
  const today = new Date(now)
  const two = (n: number) => String(n).padStart(2, '0')
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()

  return sameDay ? time : s.day(d.getDate(), s.months[d.getMonth()] ?? '', time)
}
