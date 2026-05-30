import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalize } from './teams.js'
import type { TeamCode } from './types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

const ALL_CODES: TeamCode[] = [
  'ARI', 'ATL', 'BAL', 'BOS', 'CHC', 'CWS', 'CIN', 'CLE',
  'COL', 'DET', 'HOU', 'KC',  'LAA', 'LAD', 'MIA', 'MIL',
  'MIN', 'NYM', 'NYY', 'OAK', 'PHI', 'PIT', 'SD',  'SEA',
  'SF',  'STL', 'TB',  'TEX', 'TOR', 'WSH',
]

describe('canonicalize — direct lookups', () => {
  it('resolves DK shortNames', () => {
    expect(canonicalize('NYY')).toBe('NYY')
    expect(canonicalize('SFG')).toBe('SF')   // DK's Giants shortName
    expect(canonicalize('WAS')).toBe('WSH')  // DK's Nationals shortName
  })

  it('resolves DK display / FD nameAbbr form (identical between books)', () => {
    expect(canonicalize('NY Yankees')).toBe('NYY')
    expect(canonicalize('BOS Red Sox')).toBe('BOS')
    expect(canonicalize('KC Royals')).toBe('KC')
  })

  it('resolves FD runnerName form (full city + nickname)', () => {
    expect(canonicalize('New York Yankees')).toBe('NYY')
    expect(canonicalize('Boston Red Sox')).toBe('BOS')
    expect(canonicalize('Kansas City Royals')).toBe('KC')
    expect(canonicalize('St. Louis Cardinals')).toBe('STL')  // period stripped
  })

  it('handles Athletics edge case (no city prefix in either book)', () => {
    expect(canonicalize('Athletics')).toBe('OAK')
    expect(canonicalize("A's")).toBe('OAK')
    expect(canonicalize('Oakland Athletics')).toBe('OAK')
  })

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(canonicalize('yankees')).toBe('NYY')
    expect(canonicalize('YANKEES')).toBe('NYY')
    expect(canonicalize('  Yankees  ')).toBe('NYY')
    expect(canonicalize('NY  Yankees')).toBe('NYY')  // collapsed whitespace
  })

  it('returns null on unknown / garbage / empty input', () => {
    expect(canonicalize('foo')).toBeNull()
    expect(canonicalize('')).toBeNull()
    expect(canonicalize('   ')).toBeNull()
    expect(canonicalize('Cleveland Spiders')).toBeNull()
    // @ts-expect-error testing non-string input
    expect(canonicalize(null)).toBeNull()
    // @ts-expect-error testing non-string input
    expect(canonicalize(undefined)).toBeNull()
  })
})

describe('canonicalize — every code has at least one resolving alias', () => {
  for (const code of ALL_CODES) {
    it(`${code} has a self-resolving alias`, () => {
      expect(canonicalize(code)).toBe(code)
    })
  }
})

describe('canonicalize — DK fixture coverage', () => {
  const dkFixture = JSON.parse(
    readFileSync(join(REPO, 'discovery/fixtures/dk/markets-mlb-moneyline.json'), 'utf8'),
  )

  it('every participant name resolves', () => {
    const unresolved: string[] = []
    for (const ev of dkFixture.events ?? []) {
      for (const p of ev.participants ?? []) {
        if (canonicalize(p.name) == null) unresolved.push(p.name)
      }
    }
    expect(unresolved).toEqual([])
  })

  it('every participant shortName resolves', () => {
    const unresolved: string[] = []
    for (const ev of dkFixture.events ?? []) {
      for (const p of ev.participants ?? []) {
        const sn = p.metadata?.shortName
        if (sn && canonicalize(sn) == null) unresolved.push(sn)
      }
    }
    expect(unresolved).toEqual([])
  })

  it('every moneyline selection label resolves', () => {
    // subcategoryId=4519 is "Game Lines" — covers Moneyline, Run Line, and Total.
    // Filter by market name to isolate moneylines.
    const moneylineMarketIds = new Set<string>(
      (dkFixture.markets ?? [])
        .filter((m: { name?: string }) => m.name === 'Moneyline')
        .map((m: { id: string }) => m.id),
    )
    const unresolved: string[] = []
    for (const s of dkFixture.selections ?? []) {
      if (!moneylineMarketIds.has(s.marketId)) continue
      if (canonicalize(s.label) == null) unresolved.push(s.label)
    }
    expect(unresolved).toEqual([])
  })
})

describe('canonicalize — FD fixture coverage', () => {
  const fdFixture = JSON.parse(
    readFileSync(join(REPO, 'discovery/fixtures/fd/fixedodds-full.json'), 'utf8'),
  )

  const mlbMoneylineRunners = (): Array<{ runnerName: string; nameAbbr: string }> => {
    const markets = fdFixture.attachments?.markets ?? {}
    const out: Array<{ runnerName: string; nameAbbr: string }> = []
    for (const m of Object.values(markets) as Array<{
      marketType: string
      eventTypeId: number
      runners?: Array<{ runnerName: string; nameAbbr: string }>
    }>) {
      if (m.marketType !== 'MONEY_LINE' || m.eventTypeId !== 7511) continue
      for (const r of m.runners ?? []) out.push(r)
    }
    return out
  }

  it('every MLB moneyline runnerName resolves', () => {
    const unresolved: string[] = []
    for (const r of mlbMoneylineRunners()) {
      if (canonicalize(r.runnerName) == null) unresolved.push(r.runnerName)
    }
    expect(unresolved).toEqual([])
  })

  it('every MLB moneyline nameAbbr resolves', () => {
    const unresolved: string[] = []
    for (const r of mlbMoneylineRunners()) {
      if (canonicalize(r.nameAbbr) == null) unresolved.push(r.nameAbbr)
    }
    expect(unresolved).toEqual([])
  })
})
