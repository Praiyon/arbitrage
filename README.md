# arbitrage

POC: DK + FD MLB moneyline arb scanner via Playwright.

## Design

Master design doc and per-feature specs live in the Obsidian vault:

```
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/algos/arbitrage/
  dk-fd-mlb-arb-poc.md      ← master design
  01-discovery-harness.md
  02-team-dictionary.md
  03-json-parsers.md
  04-game-matcher.md
  05-arb-detection.md
  06-jsonl-store.md
  07-browser-runtime.md
  08-liveness-watchdog.md
  09-cli-lifecycle.md
```

Build order matches feature numbers.

## Setup

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm run dev -- --duration 4h
```

(Entrypoint not yet implemented. Build starts with feature 01.)
