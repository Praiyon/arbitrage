import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GameStore } from './matcher.js'
import { parseDk } from './books/dk.js'
import { parseFd } from './books/fd.js'
import type { Book, PriceRecord } from './types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

const dkFixture = JSON.parse(
  readFileSync(join(REPO, 'discovery/fixtures/dk/markets-mlb-moneyline.json'), 'utf8'),
)
const fdFixture = JSON.parse(
  readFileSync(join(REPO, 'discovery/fixtures/fd/fixedodds-full.json'), 'utf8'),
)

const OBSERVED_AT = Date.parse('2026-05-29T20:00:00Z')

function rec(opts: {
  book: Book
  home: string
  away: string
  startIso: string
  homeDec?: number
  awayDec?: number
  observedAt?: number
}): PriceRecord {
  return {
    book: opts.book,
    rawHomeTeam: opts.home,
    rawAwayTeam: opts.away,
    gameStartTime: opts.startIso,
    homePriceDec: opts.homeDec ?? 1.91,
    awayPriceDec: opts.awayDec ?? 1.91,
    observedAt: opts.observedAt ?? OBSERVED_AT,
  }
}

describe('GameStore — basic ingest', () => {
  it('matched DK + FD records produce a single game with both books populated', () => {
    const s = new GameStore()
    // 7:10pm ET → 2026-05-30T23:10Z
    s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T23:10:00Z', homeDec: 2.0, awayDec: 1.9 }))
    s.ingest(rec({ book: 'fd', home: 'Boston Red Sox', away: 'New York Yankees', startIso: '2026-05-30T23:10:00Z', homeDec: 2.05, awayDec: 1.85 }))

    const games = s.all()
    expect(games.length).toBe(1)
    expect(games[0]?.homeTeam).toBe('BOS')
    expect(games[0]?.awayTeam).toBe('NYY')
    expect(games[0]?.dk).toEqual({ homePriceDec: 2.0, awayPriceDec: 1.9, observedAt: OBSERVED_AT })
    expect(games[0]?.fd).toEqual({ homePriceDec: 2.05, awayPriceDec: 1.85, observedAt: OBSERVED_AT })
  })

  it('latest price per book overwrites earlier', () => {
    const s = new GameStore()
    s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T23:10:00Z', homeDec: 2.0, awayDec: 1.9 }))
    s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T23:10:00Z', homeDec: 2.10, awayDec: 1.82 }))

    expect(s.all()[0]?.dk).toEqual({ homePriceDec: 2.10, awayPriceDec: 1.82, observedAt: OBSERVED_AT })
  })

  it('ingest is idempotent for identical records', () => {
    const s = new GameStore()
    const r = rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T23:10:00Z' })
    s.ingest(r)
    s.ingest(r)
    expect(s.all().length).toBe(1)
  })
})

describe('GameStore — ±1h tolerance matching', () => {
  it('matches when start times differ by 55 min (same hour bucket)', () => {
    const s = new GameStore()
    s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T23:00:00Z' }))
    s.ingest(rec({ book: 'fd', home: 'Boston Red Sox', away: 'New York Yankees', startIso: '2026-05-30T23:55:00Z' }))
    expect(s.all().length).toBe(1)
  })

  it('matches when start times differ by exactly 60 min (tolerance boundary)', () => {
    const s = new GameStore()
    s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T23:00:00Z' }))
    s.ingest(rec({ book: 'fd', home: 'Boston Red Sox', away: 'New York Yankees', startIso: '2026-05-31T00:00:00Z' }))
    expect(s.all().length).toBe(1)
  })

  it('does NOT match when start times differ by 90 min (outside ±1h tolerance, still under DH threshold)', () => {
    const s = new GameStore()
    s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T23:00:00Z' }))
    s.ingest(rec({ book: 'fd', home: 'Boston Red Sox', away: 'New York Yankees', startIso: '2026-05-31T00:30:00Z' }))
    expect(s.all().length).toBe(2)
  })

  it('relabels gameId when an earlier record arrives later', () => {
    const s = new GameStore()
    const lateGameId = s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-31T00:00:00Z' }))
    const earlyGameId = s.ingest(rec({ book: 'fd', home: 'Boston Red Sox', away: 'New York Yankees', startIso: '2026-05-30T23:00:00Z' }))
    expect(earlyGameId).not.toBe(lateGameId)
    expect(s.all().length).toBe(1)
    // Earlier start time wins
    expect(s.all()[0]?.startTimeIso).toBe('2026-05-30T23:00:00Z')
  })
})

describe('GameStore — doubleheader handling', () => {
  it('detects DK-only doubleheader: same teams + ET date + >2h apart', () => {
    const s = new GameStore()
    // 1pm ET and 7pm ET on 2026-05-30 (= 17:00Z and 23:00Z)
    const r1 = s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T17:00:00Z' }))
    const r2 = s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T23:00:00Z' }))
    expect(r1).not.toBeNull()
    expect(r2).toBeNull()
    expect(s.all().length).toBe(0)
    expect(s.droppedDoubleheaders().size).toBe(1)
  })

  it('subsequent records for the excluded matchup+date are dropped', () => {
    const s = new GameStore()
    s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T17:00:00Z' }))
    s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T23:00:00Z' }))
    const r3 = s.ingest(rec({ book: 'fd', home: 'Boston Red Sox', away: 'New York Yankees', startIso: '2026-05-30T17:00:00Z' }))
    expect(r3).toBeNull()
    expect(s.stats().drops['doubleheader-excluded']).toBe(1)
  })

  it('same teams on different ET dates are NOT a doubleheader (DK fixture case)', () => {
    // The actual KC@TEX case from the fixture:
    // 2026-05-30T00:08:57Z (= 2026-05-29 20:08 EDT, Thu)
    // 2026-05-30T20:05:00Z (= 2026-05-30 16:05 EDT, Fri)
    // Same UTC date, different ET dates — must NOT trigger doubleheader.
    const s = new GameStore()
    const g1 = s.ingest(rec({ book: 'dk', home: 'TEX Rangers', away: 'KC Royals', startIso: '2026-05-30T00:08:57Z' }))
    const g2 = s.ingest(rec({ book: 'dk', home: 'TEX Rangers', away: 'KC Royals', startIso: '2026-05-30T20:05:00Z' }))
    expect(g1).not.toBeNull()
    expect(g2).not.toBeNull()
    expect(g1).not.toBe(g2)
    expect(s.all().length).toBe(2)
    expect(s.droppedDoubleheaders().size).toBe(0)
  })

  it('different books on same teams + time is NOT a doubleheader (just matching)', () => {
    const s = new GameStore()
    s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: '2026-05-30T17:00:00Z' }))
    s.ingest(rec({ book: 'fd', home: 'Boston Red Sox', away: 'New York Yankees', startIso: '2026-05-30T23:00:00Z' }))
    // Different books, even if >2h apart, do NOT trigger doubleheader
    // — that's just bad cross-book matching, handled by ±1h tolerance failing
    expect(s.all().length).toBe(2)
    expect(s.droppedDoubleheaders().size).toBe(0)
  })
})

describe('GameStore — drop paths', () => {
  it('unknown team drops the record and returns null', () => {
    const s = new GameStore()
    const result = s.ingest(rec({ book: 'dk', home: 'Cleveland Spiders', away: 'NY Yankees', startIso: '2026-05-30T23:10:00Z' }))
    expect(result).toBeNull()
    expect(s.all().length).toBe(0)
    expect(s.stats().drops['unknown-team']).toBe(1)
  })

  it('unparseable startTime drops and returns null', () => {
    const s = new GameStore()
    const result = s.ingest(rec({ book: 'dk', home: 'BOS Red Sox', away: 'NY Yankees', startIso: 'not-a-date' }))
    expect(result).toBeNull()
    expect(s.stats().drops['unparseable-time']).toBe(1)
  })
})

describe('GameStore — fixture run', () => {
  it('ingests DK + FD fixture records and matches games where both books have them', () => {
    const s = new GameStore()
    const dkRecs = parseDk(dkFixture, OBSERVED_AT)
    const fdRecs = parseFd(fdFixture, OBSERVED_AT)

    for (const r of dkRecs) s.ingest(r)
    for (const r of fdRecs) s.ingest(r)

    const games = s.all()
    const withBoth = games.filter((g) => g.dk && g.fd)
    const dkOnly = games.filter((g) => g.dk && !g.fd)
    const fdOnly = games.filter((g) => !g.dk && g.fd)

    expect(games.length).toBeGreaterThan(0)
    // We expect at least a handful of games matched across both books.
    expect(withBoth.length).toBeGreaterThanOrEqual(8)
    // Sanity: every matched game has coherent prices
    for (const g of withBoth) {
      expect(g.dk!.homePriceDec).toBeGreaterThan(1)
      expect(g.fd!.homePriceDec).toBeGreaterThan(1)
    }
    // For inspection / future tuning
    expect(dkOnly.length + fdOnly.length).toBeGreaterThanOrEqual(0)
  })
})
