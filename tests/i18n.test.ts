import { expect, test } from 'claude-code/testing'

import { formatTime, strings } from '../hooks/i18n'

test('auto follows the system language, a setting wins', () => {
  expect(strings('auto', 'de-AT').empty).toBe(strings('de', undefined).empty)
  expect(strings('auto', 'en-US').empty).toBe(strings('en', undefined).empty)
  expect(strings('auto', 'fr-FR').empty).toBe(strings('en', undefined).empty)
  expect(strings(undefined, undefined).empty).toBe(strings('en', undefined).empty)
  expect(strings('de', 'en-US').empty).toBe('Gerade wartet nichts auf dich.')
  expect(strings('en', 'de-DE').empty).toBe('Nothing is waiting for you.')
})

test('times read as today, or with the day', () => {
  const de = strings('de', undefined)
  const en = strings('en', undefined)
  const now = new Date(2026, 10, 18, 15, 0).getTime()
  expect(formatTime(new Date(2026, 10, 18, 9, 5).getTime(), now, de)).toBe('09:05')
  expect(formatTime(new Date(2026, 10, 17, 9, 5).getTime(), now, de)).toBe('17. Nov 09:05')
  expect(formatTime(new Date(2026, 10, 17, 9, 5).getTime(), now, en)).toBe('Nov 17 09:05')
})
