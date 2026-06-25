import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminClient } from '@/lib/supabase'
import OrderStatusControls from '@/components/admin/OrderStatusControls'
import EnteredInQbToggle from '@/components/admin/EnteredInQbToggle'
import type { OrderItemRecord, OrderRequest } from '@/lib/types'

export const dynamic = 'force-dynamic'

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface DetailPageProps {
  params: Promise<{ id: string }>
}

export default async function AdminOrderDetailPage({ params }: DetailPageProps) {
  const { id } = await params
  const db = getAdminClient()

  const { data: order } = await db
    .from('order_requests')
    .select('*')
    .eq('id', id)
    .single<OrderRequest>()

  if (!order) notFound()

  const { data: itemData } = await db
    .from('order_items')
    .select('*')
    .eq('order_id', id)
    .order('sku')
  const items = (itemData ?? []) as OrderItemRecord[]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link href="/admin/orders" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Orders
          </Link>
          <div className="mt-2 flex items-center justify-between gap-4">
            <div>
              <h1 className="font-mono text-2xl font-bold text-gray-900">{order.reference_code}</h1>
              <p className="text-sm text-gray-500">Submitted {formatDate(order.created_at)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={`/admin/api/orders/${order.id}/excel`}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Excel
              </a>
              <Link
                href={`/admin/orders/${order.id}/print`}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Sales order ↗
              </Link>
            </div>
          </div>
        </div>

        {/* Status controls */}
        <section className="mb-6 rounded-xl bg-white border border-gray-200 p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Status</h2>
          <OrderStatusControls id={order.id} initialStatus={order.status} />
          {order.status_changed_at && (
            <p className="mt-3 text-xs text-gray-400">
              Last changed {formatDate(order.status_changed_at)}
              {order.status_changed_by ? ` by ${order.status_changed_by}` : ''}
            </p>
          )}

          <div className="mt-5 border-t border-gray-100 pt-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">QuickBooks</h3>
            <EnteredInQbToggle id={order.id} initial={order.entered_in_qb} />
            {order.entered_in_qb && order.entered_in_qb_at && (
              <p className="mt-2 text-xs text-gray-400">Entered {formatDate(order.entered_in_qb_at)}</p>
            )}
          </div>
        </section>

        {/* Customer */}
        <section className="mb-6 rounded-xl bg-white border border-gray-200 p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Customer</h2>
          <dl className="grid grid-cols-3 gap-y-2 text-sm">
            <dt className="text-gray-500">Name</dt>
            <dd className="col-span-2 text-gray-900">{order.customer_name}</dd>
            <dt className="text-gray-500">Email</dt>
            <dd className="col-span-2">
              <a href={`mailto:${order.customer_email}`} className="text-red-600 hover:text-red-700">
                {order.customer_email}
              </a>
            </dd>
            <dt className="text-gray-500">Phone</dt>
            <dd className="col-span-2 text-gray-900">{order.customer_phone || '—'}</dd>
            <dt className="text-gray-500">Company</dt>
            <dd className="col-span-2 text-gray-900">{order.customer_company || '—'}</dd>
            <dt className="text-gray-500">Placed by (rep)</dt>
            <dd className="col-span-2 text-gray-900">{order.placed_by_rep || '—'}</dd>
            <dt className="text-gray-500">PO number</dt>
            <dd className="col-span-2 text-gray-900">{order.po_number || '—'}</dd>
          </dl>
          {order.notes && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{order.notes}</p>
            </div>
          )}
        </section>

        {/* Items */}
        <section className="rounded-xl bg-white border border-gray-200 overflow-hidden shadow-sm">
          <h2 className="px-5 pt-5 text-sm font-semibold uppercase tracking-wide text-gray-500">Items</h2>
          <table className="mt-3 w-full text-sm text-left">
            <thead className="border-y border-gray-100 bg-gray-50">
              <tr>
                <th className="px-5 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                <th className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Qty</th>
                <th className="px-5 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="px-5 py-3 font-mono text-xs text-gray-600">{it.sku}</td>
                  <td className="px-3 py-3 text-gray-800">{it.name}</td>
                  <td className="px-3 py-3 text-right text-gray-600">{formatPrice(it.unit_price_cents)}</td>
                  <td className="px-3 py-3 text-right text-gray-600">{it.qty}</td>
                  <td className="px-5 py-3 text-right font-semibold text-gray-900">{formatPrice(it.line_total_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-gray-50">
              <tr>
                <td colSpan={4} className="px-5 py-3 text-right text-sm font-semibold text-gray-600">Subtotal</td>
                <td className="px-5 py-3 text-right text-base font-bold text-gray-900">{formatPrice(order.subtotal_cents)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      </div>
    </div>
  )
}
