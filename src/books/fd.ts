import type { PriceRecord } from '../types.js'

export const FD_URL_PATTERN =
  /smp\.[a-z]{2}\.sportsbook\.fanduel\.com\/api\/sports\/fixedodds\/readonly\/v1\/getMarketPrices/

// MLB eventTypeId on FD's catalog. Used in conjunction with marketType
// to isolate MLB moneylines from other sports' moneylines and from
// MLB futures (which carry a different marketType like MLB_LEAGUE_WINNER_SB).
const MLB_EVENT_TYPE_ID = 7511

type FdRunner = {
  runnerName: string
  result?: { type?: string }
  runnerStatus?: string
  winRunnerOdds?: {
    trueOdds?: { decimalOdds?: { decimalOdds?: number } }
  }
}

type FdMarket = {
  marketId: string
  eventId: number
  eventTypeId: number
  marketType: string
  marketStatus?: string
  runners?: FdRunner[]
}

type FdEvent = {
  eventId: number
  openDate?: string
}

type FdResponse = {
  attachments?: {
    markets?: Record<string, FdMarket>
    events?: Record<string, FdEvent>
  }
}

function decimalFrom(r: FdRunner): number | null {
  const v = r.winRunnerOdds?.trueOdds?.decimalOdds?.decimalOdds
  return typeof v === 'number' && Number.isFinite(v) && v > 1 ? v : null
}

export function parseFd(rawJson: unknown, observedAt: number): PriceRecord[] {
  if (!rawJson || typeof rawJson !== 'object') return []
  const j = rawJson as FdResponse
  const markets = j.attachments?.markets
  const events = j.attachments?.events
  if (!markets || !events) return []

  const records: PriceRecord[] = []
  for (const market of Object.values(markets)) {
    if (market.marketType !== 'MONEY_LINE') continue
    if (market.eventTypeId !== MLB_EVENT_TYPE_ID) continue
    if (market.marketStatus && market.marketStatus !== 'OPEN') continue

    const event = events[String(market.eventId)]
    if (!event?.openDate) continue

    const startMs = Date.parse(event.openDate)
    if (!Number.isFinite(startMs)) continue
    if (startMs < observedAt) continue

    const runners = market.runners ?? []
    if (runners.length !== 2) continue

    const home = runners.find((r) => r.result?.type === 'HOME')
    const away = runners.find((r) => r.result?.type === 'AWAY')
    if (!home || !away) continue

    const homePriceDec = decimalFrom(home)
    const awayPriceDec = decimalFrom(away)
    if (homePriceDec === null || awayPriceDec === null) continue

    records.push({
      book: 'fd',
      rawHomeTeam: home.runnerName,
      rawAwayTeam: away.runnerName,
      gameStartTime: event.openDate,
      homePriceDec,
      awayPriceDec,
      observedAt,
    })
  }

  return records
}
