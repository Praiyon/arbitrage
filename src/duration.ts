// Parse durations like "4h", "30m", "90s", "500ms" → milliseconds.
// Returns null on malformed input rather than throwing so callers can
// surface a friendly error.
export function parseDuration(s: string): number | null {
  const m = /^(\d+)(h|m|s|ms)$/.exec(s.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  switch (m[2]) {
    case 'h':
      return n * 3600_000
    case 'm':
      return n * 60_000
    case 's':
      return n * 1000
    case 'ms':
      return n
  }
  return null
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}h ${m}m ${sec}s`
}
