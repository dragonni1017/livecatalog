import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { loadHiddenSearchDemand } from '@/lib/hidden-search-demand-load'
import { buildWaitingQueues, WHO_ORDER, type Who } from '@/lib/waiting-queues'

export const dynamic = 'force-dynamic'

// "Waiting on you": every queue that needs a person, with its age and who it
// is for (lib/waiting-queues.ts). Read-only. A queue whose query fails is
// left out rather than failing the page.

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

export default async function WaitingPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const { who: whoParam } = await searchParams
  const who = (WHO_ORDER as string[]).includes(whoParam ?? '') ? (whoParam as Who) : null
  const db = getAdminClient()
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

  const all = buildWaitingQueues({
    nowIso: new Date().toISOString(),
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
  const shown = who ? all.filter((q) => q.who === who) : all
  const whoCounts = new Map<Who, number>()
  for (const q of all) whoCounts.set(q.who, (whoCounts.get(q.who) ?? 0) + 1)
  const stale = all.filter((q) => q.age?.stale).length

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Dashboard</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Waiting on people</h1>
        <p className="mt-1 text-sm text-gray-500">
          Everything that needs someone to decide or do something, longest waiting first.
          {stale > 0 && <span className="font-semibold text-red-700"> {stale} untouched for over a work week.</span>}
        </p>

        <div className="mt-5 mb-4 flex flex-wrap gap-2 text-sm">
          <Link
            href="/admin/waiting"
            className={`rounded-md border px-3 py-1.5 ${!who ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            Everyone ({all.length})
          </Link>
          {WHO_ORDER.filter((w) => whoCounts.has(w)).map((w) => (
            <Link
              key={w}
              href={`/admin/waiting?who=${encodeURIComponent(w)}`}
              className={`rounded-md border px-3 py-1.5 ${who === w ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {w} ({whoCounts.get(w)})
            </Link>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="rounded-xl bg-white border border-gray-200 px-6 py-12 text-center text-sm text-gray-400">
            Nothing waiting{who ? ` on ${who}` : ''}.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {shown.map((q) => (
              <li key={q.key}>
                <Link href={q.href} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 group">
                  <span className="w-24 shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-center text-xs font-semibold text-gray-600">
                    {q.who}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-gray-900 group-hover:text-red-600">{q.title}</span>
                    <span className="block text-sm text-gray-500">
                      {q.countText}
                      {q.age && (
                        <span className={q.age.stale ? 'font-semibold text-red-700' : ''}> · {q.age.text}</span>
                      )}
                      {q.note && <span> · {q.note}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-gray-400 group-hover:text-red-500">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
