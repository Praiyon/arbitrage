import { describe, it, expect } from 'vitest'
import { parseDuration, formatDuration } from './duration.js'

describe('parseDuration', () => {
  it('parses hours', () => {
    expect(parseDuration('4h')).toBe(4 * 3600_000)
    expect(parseDuration('1h')).toBe(3600_000)
  })

  it('parses minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60_000)
  })

  it('parses seconds', () => {
    expect(parseDuration('90s')).toBe(90_000)
  })

  it('parses milliseconds', () => {
    expect(parseDuration('500ms')).toBe(500)
  })

  it('trims whitespace', () => {
    expect(parseDuration('  4h  ')).toBe(4 * 3600_000)
  })

  it('returns null on malformed input', () => {
    expect(parseDuration('4hours')).toBeNull()
    expect(parseDuration('-1h')).toBeNull()
    expect(parseDuration('1.5h')).toBeNull()
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('h')).toBeNull()
    expect(parseDuration('forever')).toBeNull()
  })
})

describe('formatDuration', () => {
  it('formats hms', () => {
    expect(formatDuration(4 * 3600_000 + 12_000)).toBe('4h 0m 12s')
    expect(formatDuration(259_000)).toBe('0h 4m 19s')
    expect(formatDuration(0)).toBe('0h 0m 0s')
  })
})
