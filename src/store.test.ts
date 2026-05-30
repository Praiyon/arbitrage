import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlStore, type PriceRowJsonl, type ArbRowJsonl } from './store.js'
import type { TeamCode } from './types.js'

let dir: string
let pricesPath: string
let arbsPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbitrage-store-'))
  pricesPath = join(dir, 'prices.jsonl')
  arbsPath = join(dir, 'arbs.jsonl')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const samplePrice = (overrides: Partial<PriceRowJsonl> = {}): PriceRowJsonl => ({
  ts: 1_780_000_000_000,
  book: 'dk',
  gameId: 'NYY@BOS:2026-05-30T19',
  home: 'BOS' as TeamCode,
  away: 'NYY' as TeamCode,
  startTimeIso: '2026-05-30T23:10:00Z',
  homePriceDec: 2.0,
  awayPriceDec: 1.91,
  ...overrides,
})

const sampleArb = (overrides: Partial<ArbRowJsonl> = {}): ArbRowJsonl => ({
  detectedAt: 1_780_000_000_500,
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
})

describe('JsonlStore — basic append', () => {
  it('writes one JSON line per appendPriceRow', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    store.appendPriceRow(samplePrice())
    store.appendPriceRow(samplePrice({ book: 'fd', homePriceDec: 2.10 }))
    await store.close()

    const lines = readFileSync(pricesPath, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    const parsed = lines.map((l) => JSON.parse(l))
    expect(parsed[0]?.book).toBe('dk')
    expect(parsed[1]?.book).toBe('fd')
    expect(parsed[1]?.homePriceDec).toBe(2.10)
  })

  it('writes one JSON line per appendArbRow', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    store.appendArbRow(sampleArb())
    store.appendArbRow(sampleArb({ direction: 'B', edgePct: 0.015 }))
    await store.close()

    const lines = readFileSync(arbsPath, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    const parsed = lines.map((l) => JSON.parse(l))
    expect(parsed[0]?.direction).toBe('A')
    expect(parsed[1]?.direction).toBe('B')
  })

  it('does not pretty-print (one row = one line, no embedded newlines)', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    store.appendPriceRow(samplePrice())
    await store.close()
    const content = readFileSync(pricesPath, 'utf8')
    // Should be exactly one line + trailing newline; no internal newlines.
    expect(content.match(/\n/g)?.length).toBe(1)
  })

  it('emits valid JSON per line', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    for (let i = 0; i < 50; i++) {
      store.appendPriceRow(samplePrice({ ts: 1_780_000_000_000 + i }))
    }
    await store.close()
    const lines = readFileSync(pricesPath, 'utf8').trim().split('\n')
    expect(lines.length).toBe(50)
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow()
  })
})

describe('JsonlStore — file lifecycle', () => {
  it('creates files that did not previously exist', async () => {
    expect(existsSync(pricesPath)).toBe(false)
    expect(existsSync(arbsPath)).toBe(false)
    const store = new JsonlStore({ pricesPath, arbsPath })
    store.appendPriceRow(samplePrice())
    await store.close()
    expect(existsSync(pricesPath)).toBe(true)
    expect(existsSync(arbsPath)).toBe(true)
  })

  it('appends to existing files (does NOT truncate)', async () => {
    writeFileSync(pricesPath, '{"preexisting":true}\n')
    const store = new JsonlStore({ pricesPath, arbsPath })
    store.appendPriceRow(samplePrice())
    await store.close()
    const lines = readFileSync(pricesPath, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!).preexisting).toBe(true)
  })

  it('close() flushes buffered writes', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    for (let i = 0; i < 10; i++) store.appendPriceRow(samplePrice({ ts: i }))
    await store.close()
    const content = readFileSync(pricesPath, 'utf8')
    expect(content.trim().split('\n').length).toBe(10)
  })

  it('appends after close() are no-ops (do not throw)', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    store.appendPriceRow(samplePrice())
    await store.close()
    expect(() => store.appendPriceRow(samplePrice())).not.toThrow()
    expect(() => store.appendArbRow(sampleArb())).not.toThrow()
    const lines = readFileSync(pricesPath, 'utf8').trim().split('\n')
    expect(lines.length).toBe(1)
  })

  it('double close() is a no-op (does not throw)', async () => {
    const store = new JsonlStore({ pricesPath, arbsPath })
    await store.close()
    await expect(store.close()).resolves.toBeUndefined()
  })
})

describe('JsonlStore — error handling', () => {
  it('routes write errors to onWriteError, does not throw at call site', async () => {
    const errors: Array<{ which: string; message: string }> = []
    const badPath = join(dir, 'nonexistent', 'subdir', 'prices.jsonl')
    const store = new JsonlStore({
      pricesPath: badPath,
      arbsPath,
      onWriteError: (which, err) => errors.push({ which, message: err.message }),
    })
    // The failing file's create-stream emits 'error' asynchronously;
    // give the event loop a tick before asserting.
    await new Promise((r) => setTimeout(r, 50))
    await store.close().catch(() => {})
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0]?.which).toBe('prices')
  })
})
