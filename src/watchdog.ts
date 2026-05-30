import type { Page } from 'playwright'
import type { Book } from './types.js'

export type WatchdogBookOpts = {
  // Scheduled-reload cadence. For DK this is effectively the polling rate
  // (DK doesn't naturally re-poll markets, so the reload is the refresh).
  // For FD it's a safety net on top of FD's own ~7s polling.
  reloadEveryMs: number
  // If no intercept arrives within this much after a reload, alarm + reload.
  postReloadStallMs: number
  // Optional: if a book naturally polls between reloads (FD), alarm + reload
  // when an intercept hasn't been seen in this long. Omit for books that
  // don't naturally re-poll (DK).
  pollStallMs?: number
}

export type WatchdogRuntime = {
  getPage(book: Book): Page | undefined
  lastInterceptAt(book: Book): number
}

export type WatchdogDeps = {
  runtime: WatchdogRuntime
  onAlarm: (book: Book, reason: string) => void
  onReload?: (book: Book, reason: string) => void
  onLog?: (msg: string) => void
  now?: () => number
}

export type WatchdogOpts = {
  books: Partial<Record<Book, WatchdogBookOpts>>
  checkEveryMs?: number
}

export const DEFAULT_DK_OPTS: WatchdogBookOpts = {
  reloadEveryMs: 90_000,
  postReloadStallMs: 30_000,
}

export const DEFAULT_FD_OPTS: WatchdogBookOpts = {
  reloadEveryMs: 300_000,
  postReloadStallMs: 30_000,
  pollStallMs: 60_000,
}

export const DEFAULT_CHECK_INTERVAL_MS = 15_000

export class Watchdog {
  private timer: NodeJS.Timeout | undefined
  // Anchored at start() so the first scheduled reload waits a full
  // reloadEveryMs window. Updated each time a reload is issued.
  private lastReloadAt = new Map<Book, number>()
  // True after the watchdog has actually issued a reload (vs. the initial
  // anchor). Gates the post-reload-stall check so it doesn't false-positive
  // before any real reload has happened.
  private didReload = new Map<Book, boolean>()
  private reloading = new Map<Book, boolean>()
  private now: () => number

  constructor(private deps: WatchdogDeps, private opts: WatchdogOpts) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    if (this.timer) return
    const interval = this.opts.checkEveryMs ?? DEFAULT_CHECK_INTERVAL_MS
    // Anchor the reload clock at start so the first scheduled reload happens
    // one reloadEveryMs from now, not immediately.
    const t = this.now()
    for (const book of Object.keys(this.opts.books) as Book[]) {
      this.lastReloadAt.set(book, t)
    }
    this.timer = setInterval(() => void this.tick(), interval)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private async tick(): Promise<void> {
    for (const [book, opts] of Object.entries(this.opts.books) as Array<[Book, WatchdogBookOpts]>) {
      if (!opts) continue
      try {
        await this.tickBook(book, opts)
      } catch (e) {
        this.log(`[watchdog] ${book}: tick error: ${(e as Error).message}`)
      }
    }
  }

  private async tickBook(book: Book, opts: WatchdogBookOpts): Promise<void> {
    if (this.reloading.get(book)) return

    const now = this.now()
    const lastReload = this.lastReloadAt.get(book) ?? 0
    const lastIntercept = this.deps.runtime.lastInterceptAt(book)
    const sinceReload = now - lastReload

    // Scheduled reload
    if (sinceReload >= opts.reloadEveryMs) {
      await this.reload(book, 'scheduled')
      return
    }

    // Inside the post-reload grace window — skip all stall checks.
    // (Reload was just issued; intercepts haven't had time to arrive.)
    const inGrace = sinceReload < opts.postReloadStallMs

    // Post-reload stall: we issued a reload, the grace window has elapsed,
    // and still no intercept has arrived since the reload.
    if (
      this.didReload.get(book) &&
      !inGrace &&
      lastIntercept < lastReload
    ) {
      this.deps.onAlarm(book, `no intercept ${Math.floor(sinceReload / 1000)}s after reload`)
      await this.reload(book, 'post-reload-stall')
      return
    }

    // Poll stall (for books that naturally re-poll, e.g. FD). Suppressed
    // during the post-reload grace window to avoid double-firing.
    if (opts.pollStallMs !== undefined && !inGrace) {
      const sinceIntercept = now - lastIntercept
      if (lastIntercept > 0 && sinceIntercept >= opts.pollStallMs) {
        this.deps.onAlarm(book, `no intercept in ${Math.floor(sinceIntercept / 1000)}s`)
        await this.reload(book, 'poll-stall')
        return
      }
    }
  }

  private async reload(book: Book, reason: string): Promise<void> {
    if (this.reloading.get(book)) return
    const page = this.deps.runtime.getPage(book)
    if (!page) {
      this.log(`[watchdog] ${book}: no page; skipping reload (${reason})`)
      return
    }
    this.reloading.set(book, true)
    this.lastReloadAt.set(book, this.now())
    this.didReload.set(book, true)
    this.log(`[watchdog] ${book}: reload (${reason})`)
    this.deps.onReload?.(book, reason)
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
    } catch (e) {
      this.log(`[watchdog] ${book}: reload failed: ${(e as Error).message}; retrying once`)
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
      } catch (e2) {
        this.deps.onAlarm(book, `reload failed twice: ${(e2 as Error).message}`)
      }
    } finally {
      this.reloading.set(book, false)
    }
  }

  private log(msg: string): void {
    if (this.deps.onLog) this.deps.onLog(msg)
    else console.log(msg)
  }
}
