import type { getAdminClient } from '@/lib/supabase'
import { loadHiddenSearchDemand } from '@/lib/hidden-search-demand-load'
import { buildWaitingQueues, type WaitingQueue } from '@/lib/waiting-queues'

// Loads every "waiting on people" queue (lib/waiting-queues.ts). Shared by
// /admin/waiting and the weekly digest email, so both say the same thing.
// A queue whose query fails is left out rather than shown as zero.

type Db = ReturnType<typeof getAdminClient>
type Rows = { data: Record<string, unknown>[] | null; error: unknown }

async function times(q: PromiseLike<Rows>, col = 'created_at'): Promise<string[] | null> {
  const { data, error } = await q
  if (error) return null
  return (data ?? []).map((r) => String(r[col] ?? ''))
}

async function photosToTake(db: Db): Promise<number | null> {
  // Same rule as lib/photo-shot-list.ts: active, in stock, no image or flagged.
  // count:'exact' without head: a HEAD response would hide an error as a null count.
  const { count, error } = await db
    .from('products')
    .select('id', { count: 'exact' })
    .eq('is_active', true)
    .gt('stock_qty', 0)
    .or('image_url.is.null,image_url.eq.,needs_photo.eq.true')
    .limit(1)
  return error || count == null ? null : count
}

export async function loadWaitingQueues(db: Db, nowIso: string): Promise<WaitingQueue[]> {
  const pending = (table: string) => db.from(table).select('created_at').eq('status', 'pending')
  const [quotes, qb, credit, certs, shipments, caseCounts, names, prices, held, hidden, photos] = await Promise.all([
    times(db.from('order_requests').select('created_at').eq('status', 'new').is('dismissed_at', null)),
    times(db.from('order_requests').select('created_at').eq('entered_in_qb', false).neq('status', 'lost').is('dismissed_at', null)),
    times(pending('credit_applications')),
    times(db.from('resale_certificates').select('created_at').eq('status', 'pending').is('replaced_at', null)),
    times(db.from('shipments').select('staged_at').eq('status', 'staged'), 'staged_at'),
    times(pending('case_count_review_items')),
    times(pending('name_review_items')),
    times(pending('price_review_items')),
    db.from('products').select('id').not('held_price_cents', 'is', null).then(({ data, error }) => (error ? null : (data ?? []).length)),
    loadHiddenSearchDemand(db).then((d) => (d ? d.map((r) => r.lastSearched) : null)),
    photosToTake(db),
  ])
  return buildWaitingQueues({
    nowIso,
    quotesToAnswer: quotes,
    ordersForQuickBooks: qb,
    creditApplications: credit,
    resaleCertificates: certs,
    stagedShipments: shipments,
    caseCounts,
    names,
    prices,
    pricesForErply: held,
    hiddenSearched: hidden,
    photosToTake: photos,
  })
}
