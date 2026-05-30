# arbitrage

POC: DK + FD MLB moneyline arb scanner via Playwright.

Scans DraftKings + FanDuel's live MLB moneyline odds, normalizes games
across both books, and detects cross-book arbitrage opportunities at a
≥1% edge threshold. Writes every observed price to a JSONL log; writes
detected arbs to a second JSONL log; prints a summary on exit.

## Setup

```bash
npm install
npx playwright install chromium
```

You also need to run somewhere both books treat as a legal jurisdiction
(local IP from a state where DK + FD operate). The smoke runs verified
DK serving Ontario (`CA-ON-SB`) and FD serving New Jersey (`nj`); your
own region will vary.

## One-time FD warmup

FanDuel is fronted by PerimeterX, which challenges automated sessions
with a press-and-hold CAPTCHA. The runtime uses a persistent browser
profile at `./browser-profile/` so that once you solve the challenge
manually one time, the trusted cookies survive across runs.

```bash
npm run warmup-fd
```

A headed Chromium window opens at `https://sportsbook.fanduel.com/navigation/mlb`.
If the press-and-hold challenge appears, solve it (hold spacebar through
it). Wait until you can see MLB games rendered on the page. Switch to
your terminal and press Enter. The window closes and the profile is now
warmed.

You only have to do this once. Re-run if a future session shows a
challenge again (PX cookies eventually expire, or the score drifts up
after a long break).

## Run

```bash
npm run dev -- [--duration 4h] [--prices ./prices.jsonl] [--arbs ./arbs.jsonl]
```

Flags (all optional):

| Flag | Default | Description |
|---|---|---|
| `--duration` | `4h` | Run length. Accepts `h`/`m`/`s`/`ms` suffix (e.g. `90s`, `30m`). |
| `--prices` | `./prices.jsonl` | Output path for every observed price tick. |
| `--arbs` | `./arbs.jsonl` | Output path for every detected arb. |

Ctrl+C exits cleanly with the same summary as a duration timeout.

### Example

```bash
# 30-minute pre-game window run, custom output paths
npm run dev -- --duration 30m --prices ./runs/2026-05-30/prices.jsonl --arbs ./runs/2026-05-30/arbs.jsonl
```

### Live output

While the run is active, you'll see one-line events:

```
[runtime] dk: navigated to https://sportsbook.draftkings.com/leagues/baseball/mlb
[runtime] dk: region=CA-ON-SB
[runtime] fd: region=nj
[watchdog] dk: reload (scheduled)
[arb] NYY@BOS dir=A +1.42% ages dk=8s fd=11s
[watchdog] ALARM fd: no intercept in 94s
```

### On exit

The summary prints to stdout. Example after a short run:

```
=== arb-poc summary ===
Duration:           0h 1m 48s
Intercepts:         dk=15  fd=15
Distinct games:     15
Arbs detected:      0
Watchdog reloads:   dk=0  fd=0
Stall alarms:       0
```

When arbs were detected, the summary also includes:

```
Max edge observed:  2.34%
Median price age at detection:  dk=12s  fd=8s
```

## Output files

`prices.jsonl` — one JSON object per line per observed price tick:

```json
{"ts":1780118882452,"book":"dk","gameId":"DET@CWS:2026-05-30T14","home":"CWS","away":"DET","startTimeIso":"2026-05-30T18:10:00Z","homePriceDec":2.13,"awayPriceDec":1.735}
```

`arbs.jsonl` — one JSON object per detected arb:

```json
{"detectedAt":...,"gameId":"...","homeTeam":"PIT","awayTeam":"MIN","startTimeIso":"...","direction":"A","dkPrices":{"home":2.78,"away":1.42},"fdPrices":{"home":2.24,"away":1.633},"dkPriceAgeMs":4000,"fdPriceAgeMs":2000,"totalImpliedProb":0.972,"edgePct":0.028}
```

Both files are append-only — re-running with the same path appends new
data without truncating. Use a fresh path per run if you want isolated
datasets.

## When to run for the best chance of seeing arbs

Cross-book arbs on major US books are most likely **2–4 hours before
first pitch**, when starting-lineup announcements move one book's line
before the other catches up. Late-night runs (before tomorrow's lineups
are posted) typically capture a quiet baseline with no arbs — useful for
characterizing the baseline, less useful for *seeing* arbs.

A realistic MLB game-day window: **3pm–7pm ET on a slate day**.

## Other scripts

```bash
npm test         # vitest suite (139 tests)
npm run typecheck
npm run discover # disposable Playwright JSON-intercept logger
                 # (used during feature 01 to identify odds endpoints;
                 #  not part of the production run)
```

## Project layout

```
src/
  index.ts         CLI entry point
  types.ts         Shared types (TeamCode, PriceRecord, Book)
  teams.ts         30-team alias dictionary + canonicalize()
  books/dk.ts      DK URL pattern + parseDk
  books/fd.ts      FD URL pattern + parseFd
  matcher.ts       GameStore — ET-bucketed game matcher with doubleheader handling
  arb.ts           evaluate() — pure arb math, both directions, ≥1% edge
  store.ts         JsonlStore — append-only writers
  browser.ts       BrowserRuntime + processIntercept + DK_CONFIG/FD_CONFIG
  watchdog.ts     Watchdog — per-book reload cadences + stall detection
  duration.ts     parseDuration helper
  summary.ts       Exit-summary collector

discovery/        Feature 01 outputs: harness, findings, fixtures
warmup-fd.ts     Manual one-time PerimeterX challenge solver
```

## Design docs

Master design doc and per-feature specs live in an Obsidian vault:

```
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/algos/arbitrage/
  dk-fd-mlb-arb-poc.md       master design
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

Each feature doc has three sections: the original spec, an "Updates from
feature N" section noting design deltas surfaced by later work, and an
"Outcome" section recording what shipped and any deliberate deviations
from the spec.

## Known limitations / next iterations

- **In-play markets occasionally leak through.** The parser filters games
  by `startTime > observedAt`, but both books sometimes leave a game in
  the markets feed with a future nominal start time while the game is
  actually in progress (e.g. after a delay). One arb detected on captured
  fixture data appeared to be exactly this artifact. Tightening the
  pre-game filter is the natural next iteration.
- **No remote push yet.** Repo is local-only.
- **POC scope is moneyline only.** Spreads, totals, props, futures, live
  in-play markets, and any sport other than MLB are out of scope.
