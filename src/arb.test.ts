import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, THRESHOLD } from './arb.js'
import { GameStore } from './matcher.js'
import { parseDk } from './books/dk.js'
import { parseFd } from './books/fd.js'
import type { CanonicalGame } from './matcher.js'
import type { TeamCode } from './types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

const NOW = 1_780_000_000_000

function makeGame(opts: {
  dkHome: number
  dkAway: number
  fdHome: number
  fdAway: number
  dkObservedAt?: number
  fdObservedAt?: number
}): CanonicalGame {
  return {
    gameId: 'NYY@BOS:2026-05-30T19',
    homeTeam: 'BOS' as TeamCode,
    awayTeam: 'NYY' as TeamCode,
    startTimeIso: '2026-05-30T23:10:00Z',
    dk: {
      homePriceDec: opts.dkHome,
      awayPriceDec: opts.dkAway,
      observedAt: opts.dkObservedAt ?? NOW - 5_000,
    },
    fd: {
      homePriceDec: opts.fdHome,
      awayPriceDec: opts.fdAway,
      observedAt: opts.fdObservedAt ?? NOW - 3_000,
    },
  }
}

describe('evaluate — no arb on typical book vig', () => {
  it('returns [] when both books have positive vig in both directions', () => {
    // DK: home=2.0/away=2.0 → implied sum 1.0
    // FD: home=2.0/away=2.0 → implied sum 1.0
    // Direction A: 1/2.0 + 1/2.0 = 1.0  → not < 0.99
    // Direction B: same                 → not < 0.99
    const game = makeGame({ dkHome: 2.0, dkAway: 2.0, fdHome: 2.0, fdAway: 2.0 })
    expect(evaluate(game, NOW)).toEqual([])
  })

  it('returns [] for realistic book pricing (vig ~5%)', () => {
    // Typical: each book sums to ~1.05 internally
    const game = makeGame({ dkHome: 1.91, dkAway: 1.91, fdHome: 1.91, fdAway: 1.91 })
    expect(evaluate(game, NOW)).toEqual([])
  })
})

describe('evaluate — direction A fires', () => {
  const game = makeGame({ dkHome: 2.05, dkAway: 2.05, fdHome: 1.91, fdAway: 2.05 })
  const hits = evaluate(game, NOW)

  it('emits exactly one hit for direction A', () => {
    expect(hits.length).toBe(1)
    expect(hits[0]?.direction).toBe('A')
  })

  it('hit math: sum = 1/dk.home + 1/fd.away', () => {
    const hit = hits[0]!
    const expected = 1 / 2.05 + 1 / 2.05
    expect(hit.totalImpliedProb).toBeCloseTo(expected, 6)
    expect(hit.edgePct).toBeCloseTo(1 - expected, 6)
  })

  it('hit captures both books prices and ages', () => {
    const hit = hits[0]!
    expect(hit.dkPrices).toEqual({ home: 2.05, away: 2.05 })
    expect(hit.fdPrices).toEqual({ home: 1.91, away: 2.05 })
    expect(hit.dkPriceAgeMs).toBe(5_000)
    expect(hit.fdPriceAgeMs).toBe(3_000)
    expect(hit.detectedAt).toBe(NOW)
  })

  it('hit propagates game identity', () => {
    const hit = hits[0]!
    expect(hit.gameId).toBe('NYY@BOS:2026-05-30T19')
    expect(hit.homeTeam).toBe('BOS')
    expect(hit.awayTeam).toBe('NYY')
    expect(hit.startTimeIso).toBe('2026-05-30T23:10:00Z')
  })
})

describe('evaluate — direction B fires', () => {
  it('emits exactly one hit for direction B when 1/fd.home + 1/dk.away < threshold', () => {
    const game = makeGame({ dkHome: 1.91, dkAway: 2.05, fdHome: 2.05, fdAway: 1.91 })
    const hits = evaluate(game, NOW)
    expect(hits.length).toBe(1)
    expect(hits[0]?.direction).toBe('B')
    const expected = 1 / 2.05 + 1 / 2.05
    expect(hits[0]?.totalImpliedProb).toBeCloseTo(expected, 6)
  })
})

describe('evaluate — both directions fire', () => {
  it('emits two hits when both arb sums are below threshold', () => {
    // Symmetric edge — both directions equal and below threshold
    const game = makeGame({ dkHome: 2.05, dkAway: 2.05, fdHome: 2.05, fdAway: 2.05 })
    const hits = evaluate(game, NOW)
    expect(hits.length).toBe(2)
    expect(hits.map((h) => h.direction).sort()).toEqual(['A', 'B'])
  })
})

describe('evaluate — threshold boundary', () => {
  it('does NOT fire when sum equals THRESHOLD exactly', () => {
    // 1/a + 1/b = 0.99 → a = b = 2/0.99 ≈ 2.0202...
    const a = 2 / THRESHOLD
    const game = makeGame({ dkHome: a, dkAway: a, fdHome: a, fdAway: a })
    expect(evaluate(game, NOW)).toEqual([])
  })

  it('does fire when sum is just below THRESHOLD', () => {
    // 1/2.025 + 1/2.025 = 0.98765... → edge ≈ 1.23%
    const game = makeGame({ dkHome: 2.025, dkAway: 2.025, fdHome: 2.025, fdAway: 2.025 })
    const hits = evaluate(game, NOW)
    expect(hits.length).toBe(2)
  })
})

describe('evaluate — missing book data', () => {
  it('returns [] when dk is missing', () => {
    const game: CanonicalGame = {
      gameId: 'X',
      homeTeam: 'BOS' as TeamCode,
      awayTeam: 'NYY' as TeamCode,
      startTimeIso: '2026-05-30T23:10:00Z',
      fd: { homePriceDec: 1.5, awayPriceDec: 1.5, observedAt: NOW },
    }
    expect(evaluate(game, NOW)).toEqual([])
  })

  it('returns [] when fd is missing', () => {
    const game: CanonicalGame = {
      gameId: 'X',
      homeTeam: 'BOS' as TeamCode,
      awayTeam: 'NYY' as TeamCode,
      startTimeIso: '2026-05-30T23:10:00Z',
      dk: { homePriceDec: 1.5, awayPriceDec: 1.5, observedAt: NOW },
    }
    expect(evaluate(game, NOW)).toEqual([])
  })

  it('returns [] when both are missing', () => {
    const game: CanonicalGame = {
      gameId: 'X',
      homeTeam: 'BOS' as TeamCode,
      awayTeam: 'NYY' as TeamCode,
      startTimeIso: '2026-05-30T23:10:00Z',
    }
    expect(evaluate(game, NOW)).toEqual([])
  })
})

describe('evaluate — fixture sweep', () => {
  it('reports the arb count and max edge across the captured DK+FD fixture snapshot', () => {
    const dkFixture = JSON.parse(
      readFileSync(join(REPO, 'discovery/fixtures/dk/markets-mlb-moneyline.json'), 'utf8'),
    )
    const fdFixture = JSON.parse(
      readFileSync(join(REPO, 'discovery/fixtures/fd/fixedodds-full.json'), 'utf8'),
    )
    const observedAt = Date.parse('2026-05-29T20:00:00Z')
    const store = new GameStore()
    for (const r of parseDk(dkFixture, observedAt)) store.ingest(r)
    for (const r of parseFd(fdFixture, observedAt)) store.ingest(r)

    const allHits = store.all().flatMap((g) => evaluate(g, observedAt + 1000))

    // No assertion on count — this snapshot may or may not contain arbs.
    // Just assert the math doesn't blow up and every hit is structurally valid.
    for (const h of allHits) {
      expect(h.totalImpliedProb).toBeLessThan(THRESHOLD)
      expect(h.edgePct).toBeGreaterThan(0)
      expect(h.dkPrices.home).toBeGreaterThan(1)
      expect(h.fdPrices.home).toBeGreaterThan(1)
    }
  })
})
