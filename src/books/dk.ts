import type { PriceRecord } from '../types.js'

export const DK_URL_PATTERN =
  /sportsbook-nash\.draftkings\.com\/sites\/[^/]+\/api\/sportscontent\/controldata\/league\/leagueSubcategory\/v1\/markets/

type DkParticipant = {
  name: string
  venueRole: string
}

type DkEvent = {
  id: string
  name: string
  startEventDate: string
  participants?: DkParticipant[]
}

type DkMarket = {
  id: string
  eventId: string
  name: string
}

type DkSelection = {
  marketId: string
  label: string
  outcomeType: string
  trueOdds?: number
  displayOdds?: { decimal?: string }
}

type DkResponse = {
  events?: DkEvent[]
  markets?: DkMarket[]
  selections?: DkSelection[]
}

function decimalFrom(s: DkSelection): number | null {
  if (typeof s.trueOdds === 'number' && Number.isFinite(s.trueOdds) && s.trueOdds > 1) {
    return s.trueOdds
  }
  const fromDisplay = parseFloat(s.displayOdds?.decimal ?? '')
  return Number.isFinite(fromDisplay) && fromDisplay > 1 ? fromDisplay : null
}

export function parseDk(rawJson: unknown, observedAt: number): PriceRecord[] {
  if (!rawJson || typeof rawJson !== 'object') return []
  const j = rawJson as DkResponse
  if (!Array.isArray(j.events) || !Array.isArray(j.markets) || !Array.isArray(j.selections)) {
    return []
  }

  const eventsById = new Map(j.events.map((e) => [e.id, e]))
  const selectionsByMarket = new Map<string, DkSelection[]>()
  for (const sel of j.selections) {
    const list = selectionsByMarket.get(sel.marketId) ?? []
    list.push(sel)
    selectionsByMarket.set(sel.marketId, list)
  }

  const records: PriceRecord[] = []
  for (const market of j.markets) {
    if (market.name !== 'Moneyline') continue

    const event = eventsById.get(market.eventId)
    if (!event) continue

    const home = event.participants?.find((p) => p.venueRole === 'Home')
    const away = event.participants?.find((p) => p.venueRole === 'Away')
    if (!home || !away) continue

    const selections = selectionsByMarket.get(market.id) ?? []
    const homeSel = selections.find((s) => s.outcomeType === 'Home')
    const awaySel = selections.find((s) => s.outcomeType === 'Away')
    if (!homeSel || !awaySel) continue

    const homePriceDec = decimalFrom(homeSel)
    const awayPriceDec = decimalFrom(awaySel)
    if (homePriceDec === null || awayPriceDec === null) continue

    const startMs = Date.parse(event.startEventDate)
    if (!Number.isFinite(startMs)) continue
    if (startMs < observedAt) continue

    records.push({
      book: 'dk',
      rawHomeTeam: home.name,
      rawAwayTeam: away.name,
      gameStartTime: event.startEventDate,
      homePriceDec,
      awayPriceDec,
      observedAt,
    })
  }

  return records
}
