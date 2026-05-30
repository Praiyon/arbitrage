import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Watchdog,
  DEFAULT_DK_OPTS,
  DEFAULT_FD_OPTS,
  type WatchdogRuntime,
} from './watchdog.js'
import type { Book } from './types.js'

// Minimal Page stub with mockable reload.
type FakePage = {
  reload: ReturnType<typeof vi.fn>
}

type FakeRuntime = WatchdogRuntime & {
  setLastIntercept(book: Book, ts: number): void
  pages: Record<Book, FakePage>
}

function makeRuntime(): FakeRuntime {
  const intercepts: Record<Book, number> = { dk: 0, fd: 0 }
  const pages: Record<Book, FakePage> = {
    dk: { reload: vi.fn().mockResolvedValue(undefined) },
    fd: { reload: vi.fn().mockResolvedValue(undefined) },
  }
  return {
    getPage: (b) => pages[b] as unknown as Parameters<WatchdogRuntime['getPage']>[0] extends Book ? import('playwright').Page : never,
    lastInterceptAt: (b) => intercepts[b],
    setLastIntercept: (b, ts) => {
      intercepts[b] = ts
    },
    pages,
  }
}

let currentTime = 0
const now = () => currentTime

beforeEach(() => {
  currentTime = 1_000_000
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

async function advance(ms: number): Promise<void> {
  currentTime += ms
  await vi.advanceTimersByTimeAsync(ms)
}

describe('Watchdog — scheduled reloads', () => {
  it('does not reload before reloadEveryMs has elapsed', async () => {
    const runtime = makeRuntime()
    const w = new Watchdog(
      { runtime, onAlarm: vi.fn(), onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS } },
    )
    w.start()
    await advance(60_000) // less than 90s DK reloadEveryMs
    expect(runtime.pages.dk.reload).not.toHaveBeenCalled()
    w.stop()
  })

  it('fires a scheduled DK reload at ~90s', async () => {
    const runtime = makeRuntime()
    const w = new Watchdog(
      { runtime, onAlarm: vi.fn(), onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS } },
    )
    w.start()
    await advance(95_000)
    expect(runtime.pages.dk.reload).toHaveBeenCalledTimes(1)
    w.stop()
  })

  it('fires DK reloads roughly every 90s in steady state', async () => {
    const runtime = makeRuntime()
    const w = new Watchdog(
      { runtime, onAlarm: vi.fn(), onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS } },
    )
    w.start()
    await advance(95_000)  // first reload
    await advance(95_000)  // second
    await advance(95_000)  // third
    expect(runtime.pages.dk.reload).toHaveBeenCalledTimes(3)
    w.stop()
  })

  it('FD scheduled reload waits 5 minutes', async () => {
    const runtime = makeRuntime()
    const w = new Watchdog(
      { runtime, onAlarm: vi.fn(), onLog: () => {}, now },
      { books: { fd: DEFAULT_FD_OPTS } },
    )
    w.start()
    await advance(200_000) // <5min
    expect(runtime.pages.fd.reload).not.toHaveBeenCalled()
    // For this test we also need an intercept recently to suppress the
    // poll-stall path
    runtime.setLastIntercept('fd', currentTime)
    await advance(105_000) // total ~305s, past reloadEveryMs
    expect(runtime.pages.fd.reload).toHaveBeenCalledTimes(1)
    w.stop()
  })
})

describe('Watchdog — post-reload stall', () => {
  it('alarms + reloads if no intercept within postReloadStallMs of last reload', async () => {
    const runtime = makeRuntime()
    const alarm = vi.fn()
    const w = new Watchdog(
      { runtime, onAlarm: alarm, onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS } },
    )
    w.start()
    // Trigger the first scheduled reload at ~90s
    await advance(95_000)
    expect(runtime.pages.dk.reload).toHaveBeenCalledTimes(1)
    // No intercept arrives. Advance past postReloadStallMs (30s).
    await advance(35_000)
    expect(alarm).toHaveBeenCalledTimes(1)
    expect(alarm.mock.calls[0]?.[0]).toBe('dk')
    expect(runtime.pages.dk.reload).toHaveBeenCalledTimes(2)
    w.stop()
  })

  it('does NOT alarm if an intercept arrived after the reload', async () => {
    const runtime = makeRuntime()
    const alarm = vi.fn()
    const w = new Watchdog(
      { runtime, onAlarm: alarm, onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS } },
    )
    w.start()
    await advance(95_000) // scheduled reload at ~95s
    // Simulate intercept arriving 5s after the reload
    runtime.setLastIntercept('dk', currentTime + 5_000)
    await advance(35_000)
    expect(alarm).not.toHaveBeenCalled()
    w.stop()
  })
})

describe('Watchdog — poll stall (FD only)', () => {
  it('alarms + reloads if FD has not emitted in pollStallMs', async () => {
    const runtime = makeRuntime()
    const alarm = vi.fn()
    const w = new Watchdog(
      { runtime, onAlarm: alarm, onLog: () => {}, now },
      { books: { fd: DEFAULT_FD_OPTS } },
    )
    w.start()
    // Initial intercept arrives shortly after start
    runtime.setLastIntercept('fd', currentTime + 1_000)
    await advance(5_000)
    // No more intercepts for 80s (>60s pollStallMs)
    await advance(80_000)
    expect(alarm).toHaveBeenCalled()
    expect(runtime.pages.fd.reload).toHaveBeenCalledTimes(1)
    w.stop()
  })

  it('DK never alarms on poll stall (no pollStallMs configured)', async () => {
    const runtime = makeRuntime()
    const alarm = vi.fn()
    const w = new Watchdog(
      { runtime, onAlarm: alarm, onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS } },
    )
    w.start()
    // Intercept at start, then nothing for 60s. DK should NOT alarm
    // because pollStallMs is omitted.
    runtime.setLastIntercept('dk', currentTime + 1_000)
    await advance(60_000)
    expect(alarm).not.toHaveBeenCalled()
    w.stop()
  })
})

describe('Watchdog — reload failures', () => {
  it('retries reload once on failure', async () => {
    const runtime = makeRuntime()
    runtime.pages.dk.reload
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce(undefined)
    const alarm = vi.fn()
    const w = new Watchdog(
      { runtime, onAlarm: alarm, onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS } },
    )
    w.start()
    await advance(95_000)
    expect(runtime.pages.dk.reload).toHaveBeenCalledTimes(2)
    expect(alarm).not.toHaveBeenCalled()
    w.stop()
  })

  it('alarms after two consecutive reload failures', async () => {
    const runtime = makeRuntime()
    runtime.pages.dk.reload
      .mockRejectedValueOnce(new Error('first fail'))
      .mockRejectedValueOnce(new Error('second fail'))
    const alarm = vi.fn()
    const w = new Watchdog(
      { runtime, onAlarm: alarm, onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS } },
    )
    w.start()
    await advance(95_000)
    expect(alarm).toHaveBeenCalled()
    expect(alarm.mock.calls[0]?.[1]).toMatch(/reload failed twice/)
    w.stop()
  })
})

describe('Watchdog — book isolation', () => {
  it('one book in alarm state does not block the other', async () => {
    const runtime = makeRuntime()
    runtime.pages.dk.reload.mockRejectedValue(new Error('always fails'))
    const alarm = vi.fn()
    const w = new Watchdog(
      { runtime, onAlarm: alarm, onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS, fd: DEFAULT_FD_OPTS } },
    )
    w.start()
    // Keep FD intercepts fresh as we advance so poll-stall doesn't fire on FD.
    for (let i = 0; i < 7; i++) {
      runtime.setLastIntercept('fd', currentTime)
      await advance(15_000)
    }
    // ~105s in: DK reload should have fired (scheduled at 90s) and failed,
    // but FD's scheduled reload (5min) hasn't yet.
    expect(runtime.pages.dk.reload).toHaveBeenCalled()
    expect(runtime.pages.fd.reload).not.toHaveBeenCalled()
    // Advance to past FD's 5min mark, keeping intercepts fresh.
    for (let i = 0; i < 14; i++) {
      runtime.setLastIntercept('fd', currentTime)
      await advance(15_000)
    }
    expect(runtime.pages.fd.reload).toHaveBeenCalled()
    w.stop()
  })
})

describe('Watchdog — lifecycle', () => {
  it('stop() halts further ticks', async () => {
    const runtime = makeRuntime()
    const w = new Watchdog(
      { runtime, onAlarm: vi.fn(), onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS } },
    )
    w.start()
    await advance(50_000)
    w.stop()
    await advance(100_000) // would normally trigger a reload
    expect(runtime.pages.dk.reload).not.toHaveBeenCalled()
  })

  it('start() is idempotent', async () => {
    const runtime = makeRuntime()
    const w = new Watchdog(
      { runtime, onAlarm: vi.fn(), onLog: () => {}, now },
      { books: { dk: DEFAULT_DK_OPTS } },
    )
    w.start()
    w.start() // second call should be a no-op
    await advance(95_000)
    expect(runtime.pages.dk.reload).toHaveBeenCalledTimes(1)
    w.stop()
  })
})
