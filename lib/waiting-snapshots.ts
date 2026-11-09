import type { getAdminClient } from '@/lib/supabase'
import { pacificDate } from '@/lib/order-age'
import type { WaitingQueue } from '@/lib/waiting-queues'
import { pickBaseline, type Baseline, type SnapshotRow } from '@/lib/waiting-trend'

// Saves today's queue counts (waiting_snapshots, migration 0074) and loads
// the baseline to compare with (lib/waiting-trend.ts). Both are best-effort:
// on any error the page just shows no "since last week".

type Db = ReturnType<typeof getAdminClient>

export async function saveWaitingSnapshot(db: Db, queues: WaitingQueue[], nowIso: string): Promise<void> {
  if (!queues.length) return
  const day = pacificDate(nowIso)
  const { error } = await db
    .from('waiting_snapshots')
    .upsert(queues.map((q) => ({ day, queue: q.key, count: q.count, updated_at: nowIso })), { onConflict: 'day,queue' })
  if (error) console.error('[waiting-snapshots] save failed:', error.message)
}

export async function loadWaitingBaseline(db: Db, nowIso: string): Promise<Baseline | null> {
  const today = pacificDate(nowIso)
  // 60 days is plenty to find a week-old day; keeps the read small.
  const from = pacificDate(new Date(Date.parse(nowIso) - 60 * 86_400_000).toISOString())
  const { data, error } = await db
    .from('waiting_snapshots')
    .select('day, queue, count')
    .gte('day', from)
    .lt('day', today)
    .limit(5000)
  if (error) {
    console.error('[waiting-snapshots] load failed:', error.message)
    return null
  }
  return pickBaseline((data ?? []) as SnapshotRow[], today)
}
