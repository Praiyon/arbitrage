// Feature 01 — Discovery harness. Disposable.
//
// Launches headed Chromium with two contexts (DK + FD), navigates each to its
// MLB markets page, and logs every JSON XHR. Run for ~5 min per book while
// clicking through MLB markets to identify odds-bearing endpoints and confirm
// login is not required.
//
// Outputs:
//   discovery/dk-responses.log    one JSON line per intercepted JSON response
//   discovery/fd-responses.log    same
//   discovery/responses/{book}/   full response bodies for JSON >= 1KB
//
// Run: npm run discover
//
// Throw away after feature 03 (parsers) is done.

import { chromium, type Page } from 'playwright'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// Best-guess starting URLs. If the live site redirects or geofences differently,
// edit and re-run. Confirming the right page is part of this feature's purpose.
const BOOKS = [
  {
    book: 'dk',
    url: 'https://sportsbook.draftkings.com/leagues/baseball/mlb',
  },
  {
    book: 'fd',
    url: 'https://sportsbook.fanduel.com/navigation/mlb',
  },
] as const

const MIN_DUMP_BYTES = 1024
const counts: Record<string, number> = {}

async function ensureDir(p: string) {
  await mkdir(p, { recursive: true })
}

async function attach(book: string, page: Page) {
  const logPath = join(HERE, `${book}-responses.log`)
  const dumpDir = join(HERE, 'responses', book)
  await ensureDir(dumpDir)
  counts[book] = 0

  page.on('response', async (resp) => {
    try {
      const ct = resp.headers()['content-type'] ?? ''
      if (!ct.includes('json')) return

      const status = resp.status()
      const url = resp.url()

      let body = ''
      try {
        body = await resp.text()
      } catch (e) {
        body = `<body-read-error: ${(e as Error).message}>`
      }
      const size = body.length

      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        book,
        status,
        size,
        url,
        bodyHead: body.slice(0, 200).replace(/\s+/g, ' '),
      })
      await appendFile(logPath, entry + '\n')

      if (size >= MIN_DUMP_BYTES && !body.startsWith('<body-read-error')) {
        const hash = createHash('sha1').update(url).digest('hex').slice(0, 8)
        const stamp = Date.now()
        const dumpPath = join(dumpDir, `${stamp}-${hash}.json`)
        await writeFile(dumpPath, body)
      }

      counts[book] = (counts[book] ?? 0) + 1
    } catch (e) {
      console.error(`[${book}] handler err:`, (e as Error).message)
    }
  })
}

function startTicker() {
  const start = Date.now()
  return setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000)
    const parts = Object.entries(counts).map(([b, c]) => `${b}=${c}`).join('  ')
    process.stdout.write(`\r[${elapsed}s]  ${parts}   `)
  }, 2000)
}

async function main() {
  const browser = await chromium.launch({ headless: false })
  const ticker = startTicker()

  try {
    for (const cfg of BOOKS) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      })
      const page = await ctx.newPage()
      await attach(cfg.book, page)
      console.log(`[${cfg.book}] -> ${cfg.url}`)
      try {
        await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        console.log(`[${cfg.book}] loaded`)
      } catch (e) {
        console.error(`[${cfg.book}] navigation failed:`, (e as Error).message)
      }
    }

    console.log('\nBrowse MLB markets in each tab for ~5 min.')
    console.log('Watch dk-responses.log / fd-responses.log to identify odds endpoints.')
    console.log('Press Ctrl+C to exit.\n')

    await new Promise<void>(() => {})
  } finally {
    clearInterval(ticker)
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
