import { describe, expect, test } from 'claude-code/testing'

import { formatTime, LANGUAGES, strings } from '../hooks/i18n'
import { ITEM_TYPES } from '../hooks/core'

describe('languages', () => {
  test('auto follows the system language, a setting wins, English is the fallback', () => {
    expect(strings('auto', 'de-AT')).toBe(LANGUAGES.de)
    expect(strings('auto', 'fr-FR')).toBe(LANGUAGES.fr)
    expect(strings('auto', 'pt_BR')).toBe(LANGUAGES.pt)
    expect(strings('auto', 'zh-Hans-CN')).toBe(LANGUAGES.zh)
    expect(strings('auto', 'sv-SE')).toBe(LANGUAGES.en)
    expect(strings(undefined, undefined)).toBe(LANGUAGES.en)
    expect(strings('ja', 'en-US')).toBe(LANGUAGES.ja)
    expect(strings('xx', 'de-DE')).toBe(LANGUAGES.de)
    expect(strings('constructor', undefined)).toBe(LANGUAGES.en)
  })

  // A language added or a text added to one language only shows up here, so
  // the pane never draws `undefined` in somebody's language.
  test('every language has every text, each one filled', () => {
    const keys = Object.keys(LANGUAGES.en).sort()
    for (const [code, s] of Object.entries(LANGUAGES)) {
      expect([code, Object.keys(s).sort()]).toEqual([code, keys])
      expect([code, Object.keys(s.type).sort()]).toEqual([code, [...ITEM_TYPES].sort()])
      expect([code, s.months.length]).toEqual([code, 12])
      const texts = [
        ...Object.values(s).filter((value): value is string => typeof value === 'string'),
        ...Object.values(s.type),
        ...s.months,
        s.paneTitle(0),
        s.paneTitle(3),
        s.band(2, 1, 1),
        s.band(0, 0, 0),
        s.bandLater(4),
        s.header(0, 0),
        s.header(2, 1),
        s.progressSection(5),
        s.laterSection(6),
        s.doneSection(7),
        s.phaseState('progress', '15:30'),
        s.phaseState('later', '15:30'),
        s.from('lead'),
        s.sendResult(1, 3),
        s.sendAnyway(1, 3),
        s.unmarked(['2']),
        s.unmarked(['2', '3']),
        s.day(17, s.months[10] ?? '', '15:30'),
      ]
      for (const text of texts) expect([code, text.trim().length > 0]).toEqual([code, true])
      // The numbers a text is given show up in it.
      expect([code, s.band(2, 1, 1).includes('2')]).toEqual([code, true])
      expect([code, s.bandLater(4).includes('4')]).toEqual([code, true])
      expect([code, s.header(2, 1).includes('2')]).toEqual([code, true])
      expect([code, s.sendResult(1, 3).includes('3')]).toEqual([code, true])
      expect([code, s.unmarked(['2', '3']).includes('3')]).toEqual([code, true])
      expect([code, s.phaseState('later', '15:30').includes('15:30')]).toEqual([code, true])
      expect([code, s.day(17, 'X', '15:30').includes('17')]).toEqual([code, true])
      expect([code, s.from('lead').includes('lead')]).toEqual([code, true])
    }
  })
})

test('times read as today, or with the day in the language’s own order', () => {
  const now = new Date(2026, 10, 18, 15, 0).getTime()
  const yesterday = new Date(2026, 10, 17, 9, 5).getTime()
  expect(formatTime(new Date(2026, 10, 18, 9, 5).getTime(), now, LANGUAGES.de)).toBe('09:05')
  expect(formatTime(yesterday, now, LANGUAGES.de)).toBe('17. Nov 09:05')
  expect(formatTime(yesterday, now, LANGUAGES.en)).toBe('Nov 17 09:05')
  expect(formatTime(yesterday, now, LANGUAGES.fr)).toBe('17 nov. 09:05')
  expect(formatTime(yesterday, now, LANGUAGES.ja)).toBe('11月17日 09:05')
  expect(formatTime(yesterday, now, LANGUAGES.ko)).toBe('11월 17일 09:05')
})
