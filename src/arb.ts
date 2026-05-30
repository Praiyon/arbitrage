import type { CanonicalGame, GameId } from './matcher.js'
import type { TeamCode } from './types.js'

// Direction A: bet HOME on DK + AWAY on FD  → 1/dk.home + 1/fd.away
// Direction B: bet HOME on FD + AWAY on DK  → 1/fd.home + 1/dk.away
export type ArbDirection = 'A' | 'B'

export type ArbHit = {
  detectedAt: number
  gameId: GameId
  homeTeam: TeamCode
  awayTeam: TeamCode
  startTimeIso: string
  direction: ArbDirection
  dkPrices: { home: number; away: number }
  fdPrices: { home: number; away: number }
  dkPriceAgeMs: number
  fdPriceAgeMs: number
  totalImpliedProb: number
  edgePct: number
}

// Sum of implied probabilities below this counts as an arb (≥1% edge).
export const THRESHOLD = 0.99

export function evaluate(game: CanonicalGame, now: number): ArbHit[] {
  if (!game.dk || !game.fd) return []
  const dk = game.dk
  const fd = game.fd

  const hits: ArbHit[] = []

  const sumA = 1 / dk.homePriceDec + 1 / fd.awayPriceDec
  if (sumA < THRESHOLD) {
    hits.push({
      detectedAt: now,
      gameId: game.gameId,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      startTimeIso: game.startTimeIso,
      direction: 'A',
      dkPrices: { home: dk.homePriceDec, away: dk.awayPriceDec },
      fdPrices: { home: fd.homePriceDec, away: fd.awayPriceDec },
      dkPriceAgeMs: now - dk.observedAt,
      fdPriceAgeMs: now - fd.observedAt,
      totalImpliedProb: sumA,
      edgePct: 1 - sumA,
    })
  }

  const sumB = 1 / fd.homePriceDec + 1 / dk.awayPriceDec
  if (sumB < THRESHOLD) {
    hits.push({
      detectedAt: now,
      gameId: game.gameId,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      startTimeIso: game.startTimeIso,
      direction: 'B',
      dkPrices: { home: dk.homePriceDec, away: dk.awayPriceDec },
      fdPrices: { home: fd.homePriceDec, away: fd.awayPriceDec },
      dkPriceAgeMs: now - dk.observedAt,
      fdPriceAgeMs: now - fd.observedAt,
      totalImpliedProb: sumB,
      edgePct: 1 - sumB,
    })
  }

  return hits
}
