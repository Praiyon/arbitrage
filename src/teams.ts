import type { TeamCode } from './types.js'

// Aliases must be pre-normalized: lowercase, periods stripped, whitespace collapsed.
// Forms observed in discovery/fixtures/{dk,fd}/ are recorded, plus common short
// names. canonicalize() applies the same normalization to the input.
const ALIASES: Record<string, TeamCode> = {
  // ARI
  'ari': 'ARI', 'ari diamondbacks': 'ARI', 'arizona diamondbacks': 'ARI', 'diamondbacks': 'ARI',
  // ATL
  'atl': 'ATL', 'atl braves': 'ATL', 'atlanta braves': 'ATL', 'braves': 'ATL',
  // BAL
  'bal': 'BAL', 'bal orioles': 'BAL', 'baltimore orioles': 'BAL', 'orioles': 'BAL',
  // BOS
  'bos': 'BOS', 'bos red sox': 'BOS', 'boston red sox': 'BOS', 'red sox': 'BOS',
  // CHC
  'chc': 'CHC', 'chi cubs': 'CHC', 'chicago cubs': 'CHC', 'cubs': 'CHC',
  // CWS — DK uses CWS shortName; CHW also seen elsewhere
  'cws': 'CWS', 'chw': 'CWS', 'chi white sox': 'CWS', 'chicago white sox': 'CWS', 'white sox': 'CWS',
  // CIN
  'cin': 'CIN', 'cin reds': 'CIN', 'cincinnati reds': 'CIN', 'reds': 'CIN',
  // CLE
  'cle': 'CLE', 'cle guardians': 'CLE', 'cleveland guardians': 'CLE', 'guardians': 'CLE',
  // COL
  'col': 'COL', 'col rockies': 'COL', 'colorado rockies': 'COL', 'rockies': 'COL',
  // DET
  'det': 'DET', 'det tigers': 'DET', 'detroit tigers': 'DET', 'tigers': 'DET',
  // HOU
  'hou': 'HOU', 'hou astros': 'HOU', 'houston astros': 'HOU', 'astros': 'HOU',
  // KC
  'kc': 'KC', 'kcr': 'KC', 'kc royals': 'KC', 'kansas city royals': 'KC', 'royals': 'KC',
  // LAA
  'laa': 'LAA', 'la angels': 'LAA', 'los angeles angels': 'LAA', 'angels': 'LAA',
  // LAD
  'lad': 'LAD', 'la dodgers': 'LAD', 'los angeles dodgers': 'LAD', 'dodgers': 'LAD',
  // MIA
  'mia': 'MIA', 'mia marlins': 'MIA', 'miami marlins': 'MIA', 'marlins': 'MIA',
  // MIL
  'mil': 'MIL', 'mil brewers': 'MIL', 'milwaukee brewers': 'MIL', 'brewers': 'MIL',
  // MIN
  'min': 'MIN', 'min twins': 'MIN', 'minnesota twins': 'MIN', 'twins': 'MIN',
  // NYM
  'nym': 'NYM', 'ny mets': 'NYM', 'new york mets': 'NYM', 'mets': 'NYM',
  // NYY
  'nyy': 'NYY', 'ny yankees': 'NYY', 'new york yankees': 'NYY', 'yankees': 'NYY',
  // OAK — both books emit "Athletics" (no city) post-relocation; DK shortName "A's"
  'oak': 'OAK', 'athletics': 'OAK', "a's": 'OAK', 'oakland athletics': 'OAK', 'oak athletics': 'OAK',
  // PHI
  'phi': 'PHI', 'phi phillies': 'PHI', 'philadelphia phillies': 'PHI', 'phillies': 'PHI',
  // PIT
  'pit': 'PIT', 'pit pirates': 'PIT', 'pittsburgh pirates': 'PIT', 'pirates': 'PIT',
  // SD
  'sd': 'SD', 'sdp': 'SD', 'sd padres': 'SD', 'san diego padres': 'SD', 'padres': 'SD',
  // SEA
  'sea': 'SEA', 'sea mariners': 'SEA', 'seattle mariners': 'SEA', 'mariners': 'SEA',
  // SF — DK uses SFG shortName
  'sf': 'SF', 'sfg': 'SF', 'sf giants': 'SF', 'san francisco giants': 'SF', 'giants': 'SF',
  // STL — period stripped by normalize()
  'stl': 'STL', 'stl cardinals': 'STL', 'st louis cardinals': 'STL', 'saint louis cardinals': 'STL', 'cardinals': 'STL',
  // TB
  'tb': 'TB', 'tbr': 'TB', 'tb rays': 'TB', 'tampa bay rays': 'TB', 'rays': 'TB',
  // TEX
  'tex': 'TEX', 'tex rangers': 'TEX', 'texas rangers': 'TEX', 'rangers': 'TEX',
  // TOR
  'tor': 'TOR', 'tor blue jays': 'TOR', 'toronto blue jays': 'TOR', 'blue jays': 'TOR',
  // WSH — DK uses WAS shortName; "Nats" is common
  'wsh': 'WSH', 'was': 'WSH', 'wsh nationals': 'WSH', 'was nationals': 'WSH',
  'washington nationals': 'WSH', 'nationals': 'WSH', 'nats': 'WSH',
}

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function canonicalize(rawName: string): TeamCode | null {
  if (typeof rawName !== 'string') return null
  const key = normalize(rawName)
  if (!key) return null
  return ALIASES[key] ?? null
}
