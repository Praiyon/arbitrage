import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDk, DK_URL_PATTERN } from './dk.js'
import { canonicalize } from '../teams.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')

const dkFixture = JSON.parse(
  readFileSync(join(REPO, 'discovery/fixtures/dk/markets-mlb-moneyline.json'), 'utf8'),
)
const fdFixture = JSON.parse(
  readFileSync(join(REPO, 'discovery/fixtures/fd/fixedodds-full.json'), 'utf8'),
)

// Pin observedAt before any of the fixture's MLB games so the "skip past games"
// guard doesn't drop everything when this test runs months from now.
const FIXTURE_OBSERVED_AT = Date.parse('2026-05-29T20:00:00Z')

describe('DK_URL_PATTERN', () => {
  it('matches the captured DK markets URL (Ontario region)', () => {
    const url =
      'https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?templateVars=84240'
    expect(DK_URL_PATTERN.test(url)).toBe(true)
  })

  it('matches a hypothetical US-state region', () => {
    const url =
      'https://sportsbook-nash.draftkings.com/sites/US-NJ-SB/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?templateVars=84240'
    expect(DK_URL_PATTERN.test(url)).toBe(true)
  })

  it('does not match unrelated DK URLs', () => {
    expect(DK_URL_PATTERN.test('https://www.draftkings.com/dk-public-content/foo')).toBe(false)
    expect(
      DK_URL_PATTERN.test('https://sportsbook.draftkings.com/leagues/baseball/mlb'),
    ).toBe(false)
  })
})

describe('parseDk — fixture', () => {
  const records = parseDk(dkFixture, FIXTURE_OBSERVED_AT)

  it('produces at least 6 records', () => {
    expect(records.length).toBeGreaterThanOrEqual(6)
  })

  it('all records have book="dk"', () => {
    for (const r of records) expect(r.book).toBe('dk')
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

  it('observedAt is propagated through', () => {
    for (const r of records) expect(r.observedAt).toBe(FIXTURE_OBSERVED_AT)
  })

  it('every team name canonicalizes', () => {
    for (const r of records) {
      expect(canonicalize(r.rawHomeTeam)).not.toBeNull()
      expect(canonicalize(r.rawAwayTeam)).not.toBeNull()
    }
  })
})

describe('parseDk — robustness', () => {
  it('returns [] for null / undefined / non-object input', () => {
    expect(parseDk(null, 0)).toEqual([])
    expect(parseDk(undefined, 0)).toEqual([])
    expect(parseDk(42, 0)).toEqual([])
    expect(parseDk('garbage', 0)).toEqual([])
  })

  it('returns [] for empty object', () => {
    expect(parseDk({}, 0)).toEqual([])
  })

  it('returns [] when given the FD fixture (cross-book input)', () => {
    expect(parseDk(fdFixture, 0)).toEqual([])
  })

  it('skips games entirely in the past', () => {
    const farFuture = Date.parse('2099-01-01T00:00:00Z')
    expect(parseDk(dkFixture, farFuture)).toEqual([])
  })

  it('does not emit Run Line or Total markets (subcategoryId 4519 contains all three)', () => {
    // Sanity: confirm the fixture has Run Line / Total markets we'd be at risk
    // of accidentally including if we filtered on subcategoryId alone.
    const nonMoneylineNames = (dkFixture.markets ?? [])
      .map((m: { name?: string }) => m.name)
      .filter((n: string | undefined) => n && n !== 'Moneyline')
    expect(nonMoneylineNames).toEqual(expect.arrayContaining(['Run Line', 'Total']))

    // Parser should never emit a record whose team name resembles a totals selection.
    const records = parseDk(dkFixture, FIXTURE_OBSERVED_AT)
    for (const r of records) {
      expect(r.rawHomeTeam).not.toMatch(/^(Over|Under)/)
      expect(r.rawAwayTeam).not.toMatch(/^(Over|Under)/)
    }
  })
})
