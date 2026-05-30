import { describe, it, expect } from 'vitest'
import { Summary } from './summary.js'
import { GameStore } from './matcher.js'
import type { ArbHit } from './arb.js'
import type { TeamCode } from './types.js'

const START = 1_000_000

function makeArb(overrides: Partial<ArbHit> = {}): ArbHit {
  return {
    detectedAt: START + 60_000,
    gameId: 'NYY@BOS:2026-05-30T19',
    homeTeam: 'BOS' as TeamCode,
    awayTeam: 'NYY' as TeamCode,
    startTimeIso: '2026-05-30T23:10:00Z',
    direction: 'A',
    dkPrices: { home: 2.05, away: 2.05 },
    fdPrices: { home: 1.91, away: 2.05 },
    dkPriceAgeMs: 4000,
    fdPriceAgeMs: 2000,
    totalImpliedProb: 0.976,
    edgePct: 0.024,
    ...overrides,
  }
}

describe('Summary', () => {
  it('formats an empty run', () => {
    const s = new Summary(START)
    const gs = new GameStore()
    const out = s.format(gs, START + 60_000)
    expect(out).toContain('Duration:           0h 1m 0s')
    expect(out).toContain('Intercepts:         dk=0  fd=0')
    expect(out).toContain('Distinct games:     0')
    expect(out).toContain('Arbs detected:      0')
    expect(out).toContain('Watchdog reloads:   dk=0  fd=0')
    expect(out).toContain('Stall alarms:       0')
    // Max edge line should be omitted when no arbs
    expect(out).not.toContain('Max edge observed')
  })

  it('counts intercepts per book', () => {
    const s = new Summary(START)
    for (let i = 0; i < 5; i++) s.onPriceRow('dk')
    for (let i = 0; i < 12; i++) s.onPriceRow('fd')
    const out = s.format(new GameStore(), START + 1000)
    expect(out).toContain('Intercepts:         dk=5  fd=12')
  })

  it('tracks arbs, max edge, and median ages', () => {
    const s = new Summary(START)
    s.onArbHit(makeArb({ edgePct: 0.012, dkPriceAgeMs: 4_000, fdPriceAgeMs: 2_000 }))
    s.onArbHit(makeArb({ edgePct: 0.024, dkPriceAgeMs: 12_000, fdPriceAgeMs: 6_000 }))
    s.onArbHit(makeArb({ edgePct: 0.015, dkPriceAgeMs: 8_000, fdPriceAgeMs: 4_000 }))
    const out = s.format(new GameStore(), START + 1000)
    expect(out).toContain('Arbs detected:      3')
    expect(out).toContain('Max edge observed:  2.40%')
    expect(out).toContain('dk=8s')
    expect(out).toContain('fd=4s')
  })

  it('reports drop reasons in the games line', () => {
    const s = new Summary(START)
    const gs = new GameStore()
    // Force a doubleheader exclusion via ingest
    gs.ingest({
      book: 'dk',
      rawHomeTeam: 'BOS Red Sox',
      rawAwayTeam: 'NY Yankees',
      gameStartTime: '2026-05-30T17:00:00Z',
      homePriceDec: 2,
      awayPriceDec: 2,
      observedAt: START,
    })
    gs.ingest({
      book: 'dk',
      rawHomeTeam: 'BOS Red Sox',
      rawAwayTeam: 'NY Yankees',
      gameStartTime: '2026-05-30T23:00:00Z',
      homePriceDec: 2,
      awayPriceDec: 2,
      observedAt: START,
    })
    const out = s.format(gs, START + 1000)
    expect(out).toMatch(/Distinct games:.*doubleheaders dropped/)
  })

  it('counts reloads per book', () => {
    const s = new Summary(START)
    s.onReload('dk')
    s.onReload('dk')
    s.onReload('fd')
    const out = s.format(new GameStore(), START + 1000)
    expect(out).toContain('Watchdog reloads:   dk=2  fd=1')
  })

  it('counts alarms', () => {
    const s = new Summary(START)
    s.onAlarm()
    s.onAlarm()
    const out = s.format(new GameStore(), START + 1000)
    expect(out).toContain('Stall alarms:       2')
  })
})
