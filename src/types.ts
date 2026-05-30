export type TeamCode =
  | 'ARI' | 'ATL' | 'BAL' | 'BOS' | 'CHC' | 'CWS' | 'CIN' | 'CLE'
  | 'COL' | 'DET' | 'HOU' | 'KC'  | 'LAA' | 'LAD' | 'MIA' | 'MIL'
  | 'MIN' | 'NYM' | 'NYY' | 'OAK' | 'PHI' | 'PIT' | 'SD'  | 'SEA'
  | 'SF'  | 'STL' | 'TB'  | 'TEX' | 'TOR' | 'WSH'

export type Book = 'dk' | 'fd'

export type PriceRecord = {
  book: Book
  rawHomeTeam: string
  rawAwayTeam: string
  gameStartTime: string   // ISO 8601
  homePriceDec: number    // decimal odds, > 1
  awayPriceDec: number
  observedAt: number      // epoch ms
}
