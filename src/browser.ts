import { chromium } from 'playwright-extra'
import type { BrowserContext, Page } from 'playwright'
import stealth from 'puppeteer-extra-plugin-stealth'
chromium.use(stealth())

import { evaluate, type ArbHit } from './arb.js'
import type { GameStore } from './matcher.js'
import type { JsonlStore } from './store.js'
import type { Book, PriceRecord } from './types.js'

export type BookConfig = {
  book: Book
  marketsUrl: string
  urlPattern: RegExp
  parse: (json: unknown, observedAt: number) => PriceRecord[]
}

export type RuntimeDeps = {
  store: JsonlStore
  gameStore: GameStore
  onArbHit: (hit: ArbHit) => void
  onLog?: (msg: string) => void
  now?: () => number
}

// Region/state extractors per book — used to log the geo segment of the
// first intercepted URL so the operator can verify they're scraping the
// expected jurisdiction.
const GEO_EXTRACT: Record<Book, RegExp> = {
  dk: /\/sites\/([^/]+)\/api\//,
  fd: /\/\/smp\.([a-z]{2})\.sportsbook/,
}

// Pure: process one intercepted JSON payload through parse → ingest →
// store → evaluate. Exported for unit testing without Playwright.
export function processIntercept(
  deps: RuntimeDeps,
  cfg: BookConfig,
  json: unknown,
  now: number,
): { ingested: number; arbs: number } {
  let ingested = 0
  let arbs = 0
  const records = cfg.parse(json, now)
  for (const rec of records) {
    const gameId = deps.gameStore.ingest(rec)
    if (!gameId) continue
    const game = deps.gameStore.get(gameId)
    if (!game) continue

    deps.store.appendPriceRow({
      ts: rec.observedAt,
      book: rec.book,
      gameId,
      home: game.homeTeam,
      away: game.awayTeam,
      startTimeIso: game.startTimeIso,
      homePriceDec: rec.homePriceDec,
      awayPriceDec: rec.awayPriceDec,
    })
    ingested++

    for (const hit of evaluate(game, now)) {
      deps.store.appendArbRow(hit)
      deps.onArbHit(hit)
      arbs++
    }
  }
  return { ingested, arbs }
}

export type BrowserOpts = {
  // Persistent profile directory. Cookies/state survive between runs so
  // a manually-solved PerimeterX challenge in `warmup-fd.ts` keeps the
  // browser "trusted" on subsequent automated runs.
  profileDir?: string
}

export class BrowserRuntime {
  private context: BrowserContext | undefined
  private pages = new Map<Book, Page>()
  private lastIntercept = new Map<Book, number>()
  private geoSeen = new Map<Book, string>()
  private geoCheckTimer: NodeJS.Timeout | undefined
  private profileDir: string

  constructor(
    private deps: RuntimeDeps,
    private books: BookConfig[],
    opts: BrowserOpts = {},
  ) {
    this.profileDir = opts.profileDir ?? './browser-profile'
  }

  async start(): Promise<void> {
    // Single persistent context shared across books — DK doesn't need
    // persistence but it doesn't hurt, and one chromium window with two
    // tabs is a simpler operator UX than two windows.
    const context = await chromium.launchPersistentContext(this.profileDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
    })
    this.context = context

    for (const cfg of this.books) {
      const page = await context.newPage()
      this.pages.set(cfg.book, page)
      this.lastIntercept.set(cfg.book, 0)
      this.attachHandler(cfg, page)

      try {
        await page.goto(cfg.marketsUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        this.log(`[runtime] ${cfg.book}: navigated to ${cfg.marketsUrl}`)
        await this.settle(page, cfg.book)
      } catch (e) {
        this.log(`[runtime] ${cfg.book}: navigation failed: ${(e as Error).message}`)
      }
    }

    // Report geo (or warn) 30s after start
    this.geoCheckTimer = setTimeout(() => this.reportGeo(), 30_000)
  }

  // Some books (notably FD) only fetch market prices for events the page-side
  // state has already loaded into its visible list. Without user interaction
  // the page polls its odds endpoint forever with an empty request body and
  // gets back empty payloads. A few post-navigation scrolls trigger the lazy
  // load. Harmless on books that don't need it (DK).
  private async settle(page: Page, book: Book): Promise<void> {
    await page.waitForTimeout(2000)
    for (let i = 0; i < 5; i++) {
      try {
        await page.mouse.wheel(0, 800)
      } catch {
        break
      }
      await page.waitForTimeout(1000)
    }
    this.log(`[runtime] ${book}: settled`)
  }

  private attachHandler(cfg: BookConfig, page: Page): void {
    page.on('response', async (resp) => {
      try {
        const url = resp.url()
        if (!cfg.urlPattern.test(url)) return

        let json: unknown
        try {
          json = await resp.json()
        } catch {
          return
        }

        const now = this.deps.now?.() ?? Date.now()
        this.lastIntercept.set(cfg.book, now)

        const re = GEO_EXTRACT[cfg.book]
        if (re && !this.geoSeen.has(cfg.book)) {
          const m = re.exec(url)
          if (m?.[1]) {
            this.geoSeen.set(cfg.book, m[1])
            this.log(`[runtime] ${cfg.book}: region=${m[1]}`)
          }
        }

        processIntercept(this.deps, cfg, json, now)
      } catch (e) {
        this.log(`[runtime] ${cfg.book}: handler err: ${(e as Error).message}`)
      }
    })
  }

  private reportGeo(): void {
    for (const cfg of this.books) {
      if (!this.geoSeen.has(cfg.book)) {
        this.log(
          `[runtime] ${cfg.book}: no matching intercepts in 30s — verify URL/region or check for bot wall`,
        )
      }
    }
  }

  private log(msg: string): void {
    if (this.deps.onLog) this.deps.onLog(msg)
    else console.log(msg)
  }

  async stop(): Promise<void> {
    if (this.geoCheckTimer) clearTimeout(this.geoCheckTimer)
    if (this.context) {
      await this.context.close().catch(() => {})
      this.context = undefined
    }
  }

  // For the watchdog ([[08-liveness-watchdog]]):
  getPage(book: Book): Page | undefined {
    return this.pages.get(book)
  }

  lastInterceptAt(book: Book): number {
    return this.lastIntercept.get(book) ?? 0
  }
}

// Concrete BookConfigs wired against the URL patterns + parsers from
// features 01 and 03. CLI lifecycle ([[09-cli-lifecycle]]) imports these.
import { parseDk, DK_URL_PATTERN } from './books/dk.js'
import { parseFd, FD_URL_PATTERN } from './books/fd.js'

export const DK_CONFIG: BookConfig = {
  book: 'dk',
  marketsUrl: 'https://sportsbook.draftkings.com/leagues/baseball/mlb',
  urlPattern: DK_URL_PATTERN,
  parse: parseDk,
}

export const FD_CONFIG: BookConfig = {
  book: 'fd',
  marketsUrl: 'https://sportsbook.fanduel.com/navigation/mlb',
  urlPattern: FD_URL_PATTERN,
  parse: parseFd,
}
