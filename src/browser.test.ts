import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processIntercept, DK_CONFIG, FD_CONFIG } from './browser.js'
import { JsonlStore } from './store.js'
import { GameStore } from './matcher.js'
import type { ArbHit } from './arb.js'

let dir: string
let pricesPath: string
let arbsPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbitrage-browser-'))
  pricesPath = join(dir, 'prices.jsonl')
  arbsPath = join(dir, 'arbs.jsonl')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const HERE = new URL('.', import.meta.url).pathname
const REPO = join(HERE, '..')

const dkFixture = JSON.parse(
  readFileSync(join(REPO, 'discovery/fixtures/dk/markets-mlb-moneyline.json'), 'utf8'),
)
const fdFixture = JSON.parse(
  readFileSync(join(REPO, 'discovery/fixtures/fd/fixedodds-full.json'), 'utf8'),
)

const NOW = Date.parse('2026-05-29T20:00:00Z')

describe('processIntercept — DK fixture', () => {
  it('parses, ingests, writes price rows, and detects arbs', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    const gameStore = new GameStore()
    const arbsSeen: ArbHit[] = []

    const result = processIntercept(
      { store, gameStore, onArbHit: (h) => arbsSeen.push(h) },
      DK_CONFIG,
      dkFixture,
      NOW + 1000,
    )

    await store.close()

    expect(result.ingested).toBeGreaterThanOrEqual(6)
    expect(result.arbs).toBe(0) // DK alone can't produce arbs (no FD side)

    const priceLines = readFileSync(pricesPath, 'utf8').trim().split('\n')
    expect(priceLines.length).toBe(result.ingested)
    for (const l of priceLines) {
      const row = JSON.parse(l)
      expect(row.book).toBe('dk')
      expect(row.homePriceDec).toBeGreaterThan(1)
    }
    expect(arbsSeen).toEqual([])
  })

  it('returns ingested=0 for garbage input', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    const gameStore = new GameStore()
    const r = processIntercept(
      { store, gameStore, onArbHit: () => {} },
      DK_CONFIG,
      { not: 'a real response' },
      NOW,
    )
    await store.close()
    expect(r).toEqual({ ingested: 0, arbs: 0 })
  })

  it('returns ingested=0 for cross-book input', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    const gameStore = new GameStore()
    const r = processIntercept(
      { store, gameStore, onArbHit: () => {} },
      DK_CONFIG,
      fdFixture,
      NOW,
    )
    await store.close()
    expect(r.ingested).toBe(0)
  })
})

describe('processIntercept — FD fixture', () => {
  it('parses, ingests, writes price rows', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    const gameStore = new GameStore()
    const arbsSeen: ArbHit[] = []

    const result = processIntercept(
      { store, gameStore, onArbHit: (h) => arbsSeen.push(h) },
      FD_CONFIG,
      fdFixture,
      NOW + 1000,
    )

    await store.close()

    expect(result.ingested).toBeGreaterThanOrEqual(1)
    expect(result.arbs).toBe(0)
    const priceLines = readFileSync(pricesPath, 'utf8').trim().split('\n')
    expect(priceLines.length).toBe(result.ingested)
    for (const l of priceLines) {
      const row = JSON.parse(l)
      expect(row.book).toBe('fd')
    }
  })
})

describe('processIntercept — full pipeline detects arbs when both books are loaded', () => {
  it('end-to-end DK → FD → arb hit + arbs.jsonl row', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    const gameStore = new GameStore()
    const arbsSeen: ArbHit[] = []
    const deps = { store, gameStore, onArbHit: (h: ArbHit) => arbsSeen.push(h) }

    processIntercept(deps, DK_CONFIG, dkFixture, NOW + 1000)
    processIntercept(deps, FD_CONFIG, fdFixture, NOW + 2000)

    await store.close()

    // We know from the feature 05 outcome that this fixture produces 1 arb
    // (MIN @ PIT direction A). Assert exactly that.
    expect(arbsSeen.length).toBe(1)
    expect(arbsSeen[0]?.direction).toBe('A')
    expect(arbsSeen[0]?.homeTeam).toBe('PIT')
    expect(arbsSeen[0]?.awayTeam).toBe('MIN')
    expect(arbsSeen[0]?.edgePct).toBeGreaterThan(0.02)

    const arbLines = readFileSync(arbsPath, 'utf8').trim().split('\n')
    expect(arbLines.length).toBe(1)
    expect(JSON.parse(arbLines[0]!).direction).toBe('A')
  })
})

describe('exported configs sanity', () => {
  it('DK_CONFIG has expected shape', () => {
    expect(DK_CONFIG.book).toBe('dk')
    expect(DK_CONFIG.marketsUrl).toMatch(/draftkings\.com/)
    expect(typeof DK_CONFIG.parse).toBe('function')
  })

  it('FD_CONFIG has expected shape', () => {
    expect(FD_CONFIG.book).toBe('fd')
    expect(FD_CONFIG.marketsUrl).toMatch(/fanduel\.com/)
    expect(typeof FD_CONFIG.parse).toBe('function')
  })
})
