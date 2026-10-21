import type { getAdminClient } from '@/lib/supabase'

// History of Erply sync runs (migration 0061), so a failed night is visible
// on /admin/sync after Vercel Hobby's one-hour log retention has passed.
// recordSyncRun never throws: history is best-effort and must not break a sync.

export type SyncSource = 'cron' | 'manual'
export type SyncStatus = 'ok' | 'partial' | 'error' | 'skipped'

export interface SyncRunRow {
  source: SyncSource
  status: SyncStatus
  started_at: string
  finished_at: string
  duration_ms: number
  inserted: number
  updated: number
  deactivated: number
  error_count: number
  errors: { sku?: string; row?: number; message: string }[] | null
  details: Record<string, unknown> | null
  message: string | null
}

export const MAX_STORED_ERRORS = 50

interface RunInput {
  source: SyncSource
  startedAt: number
  finishedAt?: number
  skippedReason?: string
  failure?: unknown
  result?: {
    inserted: number
    updated: number
    deactivated: number
    errors: { row?: number; sku?: string; message: string }[]
    uncategorized?: { sku: string; category: string }[]
  }
  /** Sub-results (stock sync, low-stock, abandoned carts); any with an `error` key makes the run partial. */
  details?: Record<string, unknown>
}

function hasSubError(details: Record<string, unknown> | undefined): boolean {
  return Object.values(details ?? {}).some((v) => !!v && typeof v === 'object' && 'error' in (v as object))
}

/**
 * New products the sync inserted with no matching category (see
 * resolveCategories in lib/product-sync.ts) ride along in details -- not as
 * errors: the run itself worked, someone just needs to file them.
 */
function withUncategorized(
  details: Record<string, unknown> | undefined,
  uncategorized: { sku: string; category: string }[] | undefined,
): Record<string, unknown> | null {
  if (!uncategorized?.length) return details ?? null
  return { ...details, uncategorized: { count: uncategorized.length, sample: uncategorized.slice(0, MAX_STORED_ERRORS) } }
}

/** Pure: what one run looked like. */
export function buildSyncRunRow(input: RunInput): SyncRunRow {
  const finished = input.finishedAt ?? Date.now()
  const errors = input.result?.errors ?? []
  let status: SyncStatus
  let message: string | null = null
  if (input.failure !== undefined) {
    status = 'error'
    message = input.failure instanceof Error ? input.failure.message : String(input.failure)
  } else if (input.skippedReason) {
    status = 'skipped'
    message = input.skippedReason
  } else if (errors.length > 0 || hasSubError(input.details)) {
    status = 'partial'
  } else {
    status = 'ok'
  }
  return {
    source: input.source,
    status,
    started_at: new Date(input.startedAt).toISOString(),
    finished_at: new Date(finished).toISOString(),
    duration_ms: Math.max(0, finished - input.startedAt),
    inserted: input.result?.inserted ?? 0,
    updated: input.result?.updated ?? 0,
    deactivated: input.result?.deactivated ?? 0,
    error_count: errors.length,
    errors: errors.length ? errors.slice(0, MAX_STORED_ERRORS).map((e) => ({ sku: e.sku, row: e.row, message: String(e.message).slice(0, 500) })) : null,
    details: withUncategorized(input.details, input.result?.uncategorized),
    message: message ? message.slice(0, 1000) : null,
  }
}

export async function recordSyncRun(db: ReturnType<typeof getAdminClient>, input: RunInput): Promise<void> {
  try {
    const { error } = await db.from('sync_runs').insert(buildSyncRunRow(input))
    if (error) console.error('[sync-runs] could not record run:', error.message)
  } catch (err) {
    console.error('[sync-runs] could not record run:', err)
  }
}

export interface SyncHealth {
  level: 'ok' | 'warning' | 'unknown'
  message: string
}

/**
 * Pure: is the nightly cron healthy? The cron runs once a day, so no clean
 * (ok) cron run in the last 26 hours means a night was missed or failed.
 */
export function syncHealth(
  runs: Pick<SyncRunRow, 'source' | 'status' | 'started_at'>[],
  now: number = Date.now(),
): SyncHealth {
  const cron = runs.filter((r) => r.source === 'cron').sort((a, b) => b.started_at.localeCompare(a.started_at))
  if (cron.length === 0) return { level: 'unknown', message: 'No nightly runs recorded yet. History starts with the next run.' }
  const lastOk = cron.find((r) => r.status === 'ok')
  const hours = lastOk ? (now - Date.parse(lastOk.started_at)) / 3_600_000 : Infinity
  if (hours <= 26) {
    const latest = cron[0]
    if (latest.status !== 'ok') return { level: 'warning', message: `The latest nightly run was ${latest.status}. See its details below.` }
    return { level: 'ok', message: 'The nightly sync ran cleanly in the last day.' }
  }
  return {
    level: 'warning',
    message: lastOk
      ? `No clean nightly run for ${Math.floor(hours)} hours. The latest was ${cron[0].status}.`
      : `No clean nightly run recorded. The latest was ${cron[0].status}.`,
  }
}
