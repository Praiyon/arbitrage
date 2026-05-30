import { createWriteStream, type WriteStream } from 'node:fs'
import type { ArbHit } from './arb.js'
import type { GameId } from './matcher.js'
import type { Book, TeamCode } from './types.js'

export type PriceRowJsonl = {
  ts: number
  book: Book
  gameId: GameId
  home: TeamCode
  away: TeamCode
  startTimeIso: string
  homePriceDec: number
  awayPriceDec: number
}

export type ArbRowJsonl = ArbHit

export type JsonlStoreOpts = {
  pricesPath: string
  arbsPath: string
  onWriteError?: (which: 'prices' | 'arbs', err: Error) => void
}

export class JsonlStore {
  private prices: WriteStream
  private arbs: WriteStream
  private onWriteError: (which: 'prices' | 'arbs', err: Error) => void
  private closed = false

  constructor(opts: JsonlStoreOpts) {
    this.onWriteError =
      opts.onWriteError ??
      ((which, err) => console.error(`[store] ${which} write error:`, err.message))
    this.prices = createWriteStream(opts.pricesPath, { flags: 'a' })
    this.arbs = createWriteStream(opts.arbsPath, { flags: 'a' })
    this.prices.on('error', (e) => this.onWriteError('prices', e))
    this.arbs.on('error', (e) => this.onWriteError('arbs', e))
  }

  appendPriceRow(row: PriceRowJsonl): void {
    if (this.closed) return
    this.prices.write(JSON.stringify(row) + '\n')
  }

  appendArbRow(row: ArbRowJsonl): void {
    if (this.closed) return
    this.arbs.write(JSON.stringify(row) + '\n')
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all([
      streamEnd(this.prices),
      streamEnd(this.arbs),
    ])
  }
}

function streamEnd(s: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    s.end(() => resolve())
  })
}
