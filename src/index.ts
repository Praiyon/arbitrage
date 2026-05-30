// arb-poc — DK + FD MLB moneyline arbitrage scanner.
//
// Usage:
//   npm run dev -- [--duration 4h] [--prices ./prices.jsonl] [--arbs ./arbs.jsonl]
//
// Default duration is 4 hours. Ctrl+C exits cleanly with the same summary
// as a timeout. Profile dir defaults to ./browser-profile (used by FD's
// stealth-warmed session — see warmup-fd.ts).

import { parseArgs } from 'node:util'
import { BrowserRuntime, DK_CONFIG, FD_CONFIG } from './browser.js'
import { JsonlStore } from './store.js'
import { GameStore } from './matcher.js'
import { Watchdog, DEFAULT_DK_OPTS, DEFAULT_FD_OPTS } from './watchdog.js'
import { Summary } from './summary.js'
import { parseDuration } from './duration.js'

const { values } = parseArgs({
  options: {
    duration: { type: 'string', default: '4h' },
    prices: { type: 'string', default: './prices.jsonl' },
    arbs: { type: 'string', default: './arbs.jsonl' },
  },
  allowPositionals: false,
})

const durationMs = parseDuration(values.duration!)
if (durationMs === null) {
  console.error(`Invalid --duration: ${values.duration}. Expected e.g. '4h', '30m', '90s'.`)
  process.exit(1)
}

const store = new JsonlStore({
  pricesPath: values.prices!,
  arbsPath: values.arbs!,
  onWriteError: (which, err) => console.error(`[store] ${which} write error: ${err.message}`),
})
const gameStore = new GameStore()
const summary = new Summary()

const runtime = new BrowserRuntime(
  {
    store,
    gameStore,
    onArbHit: (hit) => {
      summary.onArbHit(hit)
      const edge = (hit.edgePct * 100).toFixed(2)
      const dkAge = Math.round(hit.dkPriceAgeMs / 1000)
      const fdAge = Math.round(hit.fdPriceAgeMs / 1000)
      console.log(
        `[arb] ${hit.awayTeam}@${hit.homeTeam} dir=${hit.direction} +${edge}% ages dk=${dkAge}s fd=${fdAge}s`,
      )
    },
    onPriceRow: (book) => summary.onPriceRow(book),
    onLog: (msg) => console.log(msg),
  },
  [DK_CONFIG, FD_CONFIG],
)

const watchdog = new Watchdog(
  {
    runtime: {
      getPage: (b) => runtime.getPage(b),
      lastInterceptAt: (b) => runtime.lastInterceptAt(b),
    },
    onAlarm: (book, reason) => {
      summary.onAlarm()
      console.log(`[watchdog] ALARM ${book}: ${reason}`)
    },
    onReload: (book) => summary.onReload(book),
    onLog: (msg) => console.log(msg),
  },
  { books: { dk: DEFAULT_DK_OPTS, fd: DEFAULT_FD_OPTS } },
)

let shuttingDown = false
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[arb-poc] shutting down (${reason})`)
  try {
    watchdog.stop()
  } catch (e) {
    console.error('[arb-poc] watchdog stop error:', (e as Error).message)
  }
  try {
    await runtime.stop()
  } catch (e) {
    console.error('[arb-poc] runtime stop error:', (e as Error).message)
  }
  try {
    await store.close()
  } catch (e) {
    console.error('[arb-poc] store close error:', (e as Error).message)
  }
  summary.print(gameStore)
  process.exit(0)
}

console.log(`[arb-poc] starting; duration=${values.duration}`)
console.log(`[arb-poc] prices=${values.prices}  arbs=${values.arbs}`)
await runtime.start()
watchdog.start()

const timer = setTimeout(() => void shutdown('duration'), durationMs)
process.on('SIGINT', () => {
  clearTimeout(timer)
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  clearTimeout(timer)
  void shutdown('SIGTERM')
})
