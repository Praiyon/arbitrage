# Feature 01 — Discovery findings

Output of the 2026-05-29 discovery run. Drives [[03-json-parsers]].

## Q4: Login required?

**No** for either book. Anonymous browser receives full moneyline data:
- DK markets endpoint: 200, 148KB, contains 7 MLB games with prices
- FD fixedodds endpoint: 200, up to 2.3MB, contains all visible markets including `MONEY_LINE`

Zero `401` / `403` / login-redirect responses observed in 7 min of clicking.

## Q5: Anti-bot challenges?

**None fired.** Stock Playwright headed Chromium passes both.

- DK: no Akamai / PerimeterX / CAPTCHA in the stream
- FD: PerimeterX is present (`b.px-cdn.net`, `collector-pxjmcvubg8.px-cloud.net`) but only collected telemetry — every odds call returned 200

No need for `playwright-extra` or stealth plugins for the POC.

## URL patterns to filter in [[07-browser-runtime]]

### DK

```
https://sportsbook-nash.draftkings.com/sites/{REGION}/api/sportscontent/controldata/league/leagueSubcategory/v1/markets?...
```

- `REGION` observed: `CA-ON-SB` (Ontario). Should be `US-{STATE}-SB` for a US user.
- MLB filter: `templateVars=84240` (84240 = MLB league ID)
- Moneyline filter: `subCategoryId eq '4519'` (4519 = moneyline subcategory)
- Filter regex (loose): `/sportsbook-nash\.draftkings\.com\/sites\/[^/]+\/api\/sportscontent\/controldata\/league\/leagueSubcategory\/v1\/markets/`

### FD

```
https://smp.{state}.sportsbook.fanduel.com/api/sports/fixedodds/readonly/v1/getMarketPrices?priceHistory=0
```

- `{state}` observed: `nj` (New Jersey).
- Returns *all* visible markets across sports — parser must filter by `eventTypeId: 7511` (MLB) and `marketType: "MONEY_LINE"`.
- Filter regex: `/smp\.[a-z]{2}\.sportsbook\.fanduel\.com\/api\/sports\/fixedodds\/readonly\/v1\/getMarketPrices/`

## Polling cadence

| Book | Calls in 7 min | Cadence | Notes |
|---|---|---|---|
| DK | 1 | none observed | DK loads markets once and likely streams deltas via a channel we didn't capture (suspect WebSocket). The 5-min watchdog reload in [[08-liveness-watchdog]] is what will carry the live runtime. |
| FD | 61 | ~7s | Natural high-cadence polling — perfect for the intercept model in [[07-browser-runtime]]. |

## JSON shapes

### DK (`fixtures/dk/markets-mlb-moneyline.json`)

```
{
  events:     [ { id, name "ATL Braves @ CIN Reds", startEventDate, participants[].venueRole=Home|Away } ],
  markets:    [ { id, eventId, name "Moneyline", subcategoryId "4519" } ],
  selections: [ { marketId, label "CIN Reds", outcomeType Home|Away,
                  displayOdds: { american "+135", decimal "2.35" } } ],
  leagues:    [ { id "84240", name "MLB" } ],
  sports:     [ ... ]
}
```

Decimal odds are pre-computed in `selections[].displayOdds.decimal` — no conversion needed.

### FD (`fixtures/fd/fixedodds-full.json`)

```
{
  attachments: {
    events:       { "{eventId}": { eventId, name, openDate, competitionId, eventTypeId } },
    markets:      { "{marketId}": { marketId, eventId, marketName "Moneyline", marketType "MONEY_LINE",
                                    marketTime, runners[] } },
    competitions: { "{competitionId}": { competitionId, eventId, eventTypeId, name } },
    eventTypes:   { ... }
  }
}
```

Each market's `runners[]` (length 2 for moneyline) contains:

```
{
  runnerName "Kansas City Royals",
  nameAbbr "KC Royals",
  result.type "HOME"|"AWAY",
  winRunnerOdds: {
    americanDisplayOdds: { americanOdds -124 },
    trueOdds: { decimalOdds: { decimalOdds 1.806 } }
  }
}
```

Decimal odds are pre-computed in `winRunnerOdds.trueOdds.decimalOdds.decimalOdds`.

## Geo anomaly (to verify)

The DK URL contained `CA-ON-SB` (Ontario) while FD's was `smp.nj.` (New Jersey). If the user is physically in NJ, DK is mis-geoing — possibly a CDN edge issue. Worth visually confirming both pages show US MLB games before committing the production runtime to either region.

## Fixtures captured

- `fixtures/dk/markets-mlb-moneyline.json` — 148KB, 7 MLB games with moneyline markets and selections
- `fixtures/fd/fixedodds-full.json` — 2.3MB, full FD markets snapshot (all sports / categories)
- `fixtures/fd/fixedodds-small.json` — 22KB, smaller fixedodds variant (likely delta update — confirm in parser tests)
