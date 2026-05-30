import type { ArbHit } from './arb.js'
import type { GameStore } from './matcher.js'
import type { Book } from './types.js'
import { formatDuration } from './duration.js'

export class Summary {
  private startedAt: number
  private intercepts: Record<Book, number> = { dk: 0, fd: 0 }
  private reloads: Record<Book, number> = { dk: 0, fd: 0 }
  private alarms = 0
  private arbs: ArbHit[] = []

  constructor(now: number = Date.now()) {
    this.startedAt = now
  }

  onPriceRow(book: Book): void {
    this.intercepts[book]++
  }

  onArbHit(hit: ArbHit): void {
    this.arbs.push(hit)
  }

  onReload(book: Book): void {
    this.reloads[book]++
  }

  onAlarm(): void {
    this.alarms++
  }

  format(gameStore: GameStore, now: number = Date.now()): string {
    const elapsed = now - this.startedAt
    const stats = gameStore.stats()

    let maxEdge = 0
    const dkAges: number[] = []
    const fdAges: number[] = []
    for (const a of this.arbs) {
      if (a.edgePct > maxEdge) maxEdge = a.edgePct
      dkAges.push(a.dkPriceAgeMs)
      fdAges.push(a.fdPriceAgeMs)
    }

    const lines: string[] = []
    lines.push('=== arb-poc summary ===')
    lines.push(`Duration:           ${formatDuration(elapsed)}`)
    lines.push(`Intercepts:         dk=${this.intercepts.dk}  fd=${this.intercepts.fd}`)

    const dropParts: string[] = []
    if (stats.drops['unknown-team']) dropParts.push(`${stats.drops['unknown-team']} unknown team`)
    if (stats.doubleheaderMatchups) dropParts.push(`${stats.doubleheaderMatchups} doubleheaders`)
    if (stats.drops['unparseable-time']) dropParts.push(`${stats.drops['unparseable-time']} bad time`)
    const dropSuffix = dropParts.length ? ` (${dropParts.join(', ')} dropped)` : ''
    lines.push(`Distinct games:     ${stats.games}${dropSuffix}`)

    lines.push(`Arbs detected:      ${this.arbs.length}`)
    if (this.arbs.length > 0) {
      lines.push(`Max edge observed:  ${(maxEdge * 100).toFixed(2)}%`)
      lines.push(
        `Median price age at detection:  dk=${formatAge(median(dkAges))}  fd=${formatAge(median(fdAges))}`,
      )
    }
    lines.push(`Watchdog reloads:   dk=${this.reloads.dk}  fd=${this.reloads.fd}`)
    lines.push(`Stall alarms:       ${this.alarms}`)
    return lines.join('\n')
  }

  print(gameStore: GameStore, now: number = Date.now()): void {
    console.log('')
    console.log(this.format(gameStore, now))
  }
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${Math.round(ms / 1000)}s`
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}
