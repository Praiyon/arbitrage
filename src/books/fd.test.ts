import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFd, FD_URL_PATTERN } from './fd.js'
import { canonicalize } from '../teams.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')

const fdFixture = JSON.parse(
  readFileSync(join(REPO, 'discovery/fixtures/fd/fixedodds-full.json'), 'utf8'),
)
const dkFixture = JSON.parse(
  readFileSync(join(REPO, 'discovery/fixtures/dk/markets-mlb-moneyline.json'), 'utf8'),
)

const FIXTURE_OBSERVED_AT = Date.parse('2026-05-29T20:00:00Z')

describe('FD_URL_PATTERN', () => {
  it('matches the captured FD fixedodds URL (NJ state)', () => {
    const url =
      'https://smp.nj.sportsbook.fanduel.com/api/sports/fixedodds/readonly/v1/getMarketPrices?priceHistory=0'
    expect(FD_URL_PATTERN.test(url)).toBe(true)
  })

  it('matches a hypothetical alternate state', () => {
    const url =
      'https://smp.pa.sportsbook.fanduel.com/api/sports/fixedodds/readonly/v1/getMarketPrices'
    expect(FD_URL_PATTERN.test(url)).toBe(true)
  })

  it('does not match unrelated FD URLs', () => {
    expect(FD_URL_PATTERN.test('https://api.sportsbook.fanduel.com/sbapi/content-managed-page')).toBe(false)
    expect(FD_URL_PATTERN.test('https://sportsbook.fanduel.com/navigation/mlb')).toBe(false)
  })
})

describe('parseFd — fixture', () => {
  const records = parseFd(fdFixture, FIXTURE_OBSERVED_AT)

  it('produces at least 1 record', () => {
    expect(records.length).toBeGreaterThanOrEqual(1)
  })

  it('all records have book="fd"', () => {
    for (const r of records) expect(r.book).toBe('fd')
  })

  it('all decimal prices are > 1', () => {
    for (const r of records) {
      expect(r.homePriceDec).toBeGreaterThan(1)
      expect(r.awayPriceDec).toBeGreaterThan(1)
    }
  })

  it('all gameStartTime values are valid ISO 8601', () => {
    for (const r of records) {
      expect(Number.isFinite(Date.parse(r.gameStartTime))).toBe(true)
    }
  })

  it('every team name canonicalizes', () => {
    for (const r of records) {
      expect(canonicalize(r.rawHomeTeam)).not.toBeNull()
      expect(canonicalize(r.rawAwayTeam)).not.toBeNull()
    }
  })

  it('excludes futures markets (e.g. "American League 2026 Winner")', () => {
    // The fixture contains MLB_LEAGUE_WINNER_SB markets with MLB team runners.
    // Those must not produce PriceRecords — they aren't moneylines.
    // Heuristic check: a futures market has 12+ runners; a moneyline has 2.
    // If any emitted record corresponds to a futures market, the parser is wrong.
    const moneylineMarketCount = (() => {
      const markets = fdFixture.attachments?.markets ?? {}
      let n = 0
      for (const m of Object.values(markets) as Array<{ marketType?: string; eventTypeId?: number }>) {
        if (m.marketType === 'MONEY_LINE' && m.eventTypeId === 7511) n++
      }
      return n
    })()
    expect(records.length).toBeLessThanOrEqual(moneylineMarketCount)
  })
})

describe('parseFd — robustness', () => {
  it('returns [] for null / undefined / non-object input', () => {
    expect(parseFd(null, 0)).toEqual([])
    expect(parseFd(undefined, 0)).toEqual([])
    expect(parseFd(42, 0)).toEqual([])
    expect(parseFd('garbage', 0)).toEqual([])
  })

  it('returns [] for empty object', () => {
    expect(parseFd({}, 0)).toEqual([])
  })

  it('returns [] when given the DK fixture (cross-book input)', () => {
    expect(parseFd(dkFixture, 0)).toEqual([])
  })

  it('skips games entirely in the past', () => {
    const farFuture = Date.parse('2099-01-01T00:00:00Z')
    expect(parseFd(fdFixture, farFuture)).toEqual([])
  })
})
