import { canonicalize } from './teams.js'
import type { Book, PriceRecord, TeamCode } from './types.js'

export type GameId = string

export type BookPrices = {
  homePriceDec: number
  awayPriceDec: number
  observedAt: number
}

export type CanonicalGame = {
  gameId: GameId
  homeTeam: TeamCode
  awayTeam: TeamCode
  startTimeIso: string
  dk?: BookPrices
  fd?: BookPrices
}

// Two ingested start times for the same (book, matchup, ET date) more than
// this far apart are treated as a doubleheader.
const DOUBLEHEADER_GAP_MS = 2 * 60 * 60 * 1000

// Cross-book start-time tolerance for matching DK vs FD on the same game.
// In practice books agree on start time to within minutes, but we allow up
// to an hour so a single book's late time-update doesn't fragment the game.
const TOLERANCE_MS = 60 * 60 * 1000

const ET_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
})

function etDateHour(iso: string): { date: string; hour: number } | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const parts: Record<string, string> = {}
  for (const p of ET_FMT.formatToParts(new Date(ms))) parts[p.type] = p.value
  if (!parts.year || !parts.month || !parts.day || !parts.hour) return null
  let hour = parseInt(parts.hour, 10)
  if (hour === 24) hour = 0
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour }
}

function makeGameId(home: TeamCode, away: TeamCode, date: string, hour: number): GameId {
  return `${away}@${home}:${date}T${hour.toString().padStart(2, '0')}`
}

export type IngestDropReason =
  | 'unknown-team'
  | 'unparseable-time'
  | 'doubleheader-excluded'
  | 'doubleheader-detected'

export type IngestStats = {
  games: number
  drops: Record<IngestDropReason, number>
  doubleheaderMatchups: number
}

export class GameStore {
  private games = new Map<GameId, CanonicalGame>()
  private excluded = new Set<string>() // matchupDateKey, e.g. 'BOS@NYY:2026-05-30'
  private observedTimes = new Map<string, number[]>() // 'dk:BOS@NYY:2026-05-30' -> [epoch_ms,...]
  private drops: Record<IngestDropReason, number> = {
    'unknown-team': 0,
    'unparseable-time': 0,
    'doubleheader-excluded': 0,
    'doubleheader-detected': 0,
  }

  ingest(record: PriceRecord): GameId | null {
    const home = canonicalize(record.rawHomeTeam)
    const away = canonicalize(record.rawAwayTeam)
    if (!home || !away) {
      this.drops['unknown-team']++
      return null
    }

    const dh = etDateHour(record.gameStartTime)
    if (!dh) {
      this.drops['unparseable-time']++
      return null
    }
    const { date, hour } = dh

    const matchupDateKey = `${away}@${home}:${date}`
    if (this.excluded.has(matchupDateKey)) {
      this.drops['doubleheader-excluded']++
      return null
    }

    const startMs = Date.parse(record.gameStartTime)
    const observedKey = `${record.book}:${matchupDateKey}`
    const prior = this.observedTimes.get(observedKey) ?? []
    const farthest = prior.reduce(
      (max, t) => Math.max(max, Math.abs(t - startMs)),
      0,
    )
    if (farthest > DOUBLEHEADER_GAP_MS) {
      this.excluded.add(matchupDateKey)
      this.drops['doubleheader-detected']++
      // Remove any games already created for this matchup+ET-date
      for (const [gid, g] of this.games) {
        if (g.homeTeam !== home || g.awayTeam !== away) continue
        const gdh = etDateHour(g.startTimeIso)
        if (gdh?.date === date) this.games.delete(gid)
      }
      // Forget per-book histories for this matchup+date
      this.observedTimes.delete(`dk:${matchupDateKey}`)
      this.observedTimes.delete(`fd:${matchupDateKey}`)
      return null
    }
    prior.push(startMs)
    this.observedTimes.set(observedKey, prior)

    // Find existing game by same (home, away, ET date) whose start time is within ±TOLERANCE_MS
    let existing: CanonicalGame | undefined
    for (const g of this.games.values()) {
      if (g.homeTeam !== home || g.awayTeam !== away) continue
      const gdh = etDateHour(g.startTimeIso)
      if (gdh?.date !== date) continue
      const gMs = Date.parse(g.startTimeIso)
      if (Math.abs(gMs - startMs) <= TOLERANCE_MS) {
        existing = g
        break
      }
    }

    if (existing) {
      this.setBookPrices(existing, record.book, record)
      // If the new record's start time is earlier, relabel gameId to the earlier hour bucket
      const existingMs = Date.parse(existing.startTimeIso)
      if (startMs < existingMs) {
        this.games.delete(existing.gameId)
        existing.startTimeIso = record.gameStartTime
        existing.gameId = makeGameId(home, away, date, hour)
        this.games.set(existing.gameId, existing)
      }
      return existing.gameId
    }

    const gameId = makeGameId(home, away, date, hour)
    const fresh: CanonicalGame = {
      gameId,
      homeTeam: home,
      awayTeam: away,
      startTimeIso: record.gameStartTime,
    }
    this.setBookPrices(fresh, record.book, record)
    this.games.set(gameId, fresh)
    return gameId
  }

  private setBookPrices(g: CanonicalGame, book: Book, record: PriceRecord): void {
    const prices: BookPrices = {
      homePriceDec: record.homePriceDec,
      awayPriceDec: record.awayPriceDec,
      observedAt: record.observedAt,
    }
    if (book === 'dk') g.dk = prices
    else g.fd = prices
  }

  get(id: GameId): CanonicalGame | undefined {
    return this.games.get(id)
  }

  all(): CanonicalGame[] {
    return [...this.games.values()]
  }

  droppedDoubleheaders(): Set<string> {
    return new Set(this.excluded)
  }

  stats(): IngestStats {
    return {
      games: this.games.size,
      drops: { ...this.drops },
      doubleheaderMatchups: this.excluded.size,
    }
  }
}
