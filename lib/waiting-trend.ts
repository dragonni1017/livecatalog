// "Since last week" for /admin/waiting: compares each queue's count with a
// saved snapshot (waiting_snapshots, migration 0074). Pure.
//
// The baseline is the newest snapshot day at least 7 days old. Until a week
// of history exists, the oldest day before today is used and the label names
// its date instead ("since Nov 9").

export interface SnapshotRow {
  day: string // YYYY-MM-DD, Los Angeles
  queue: string
  count: number
}

export interface Baseline {
  day: string
  weekAgo: boolean
  counts: Map<string, number>
}

export interface QueueTrend {
  /** count now minus count then; negative = went down. */
  change: number
  text: string
  /** went down (good), went up (bad), or no change */
  direction: 'down' | 'up' | 'same'
}

/** Days from `a` to `b` (both YYYY-MM-DD). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export function pickBaseline(rows: SnapshotRow[], today: string): Baseline | null {
  const days = [...new Set(rows.map((r) => r.day))].filter((d) => d < today).sort()
  if (!days.length) return null
  const weekOld = days.filter((d) => daysBetween(d, today) >= 7)
  const day = weekOld.length ? weekOld[weekOld.length - 1] : days[0]
  const counts = new Map<string, number>()
  for (const r of rows) if (r.day === day) counts.set(r.queue, r.count)
  return { day, weekAgo: weekOld.length > 0, counts }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Change for one queue since the baseline, or null with no baseline. Empty
 * queues aren't on the page and so aren't saved: a queue missing from a
 * saved day counts as 0 then.
 */
export function queueTrend(queue: string, countNow: number, baseline: Baseline | null): QueueTrend | null {
  if (!baseline || baseline.counts.size === 0) return null
  const then = baseline.counts.get(queue) ?? 0
  const change = countNow - then
  const [, m, d] = baseline.day.split('-').map(Number)
  const since = baseline.weekAgo ? 'since last week' : `since ${MONTHS[m - 1]} ${d}`
  if (change === 0) return { change, text: `no change ${since}`, direction: 'same' }
  return {
    change,
    text: `${change < 0 ? '▼' : '▲'} ${Math.abs(change)} ${since}`,
    direction: change < 0 ? 'down' : 'up',
  }
}
