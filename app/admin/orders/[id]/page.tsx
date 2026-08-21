import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminClient } from '@/lib/supabase'
import OrderStatusControls from '@/components/admin/OrderStatusControls'
import EnteredInQbToggle from '@/components/admin/EnteredInQbToggle'
import { tierLabel, formatTierAdjustment } from '@/lib/order-rules'
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

  type CustomerProfile = {
    id: string
    name: string | null
    company: string | null
    discount_percent: number
    notes: string | null
  }
  let customer: CustomerProfile | null = null
  try {
    const { data } = await db
      .from('customers')
      .select('id, name, company, discount_percent, notes')
      .eq('email', order.customer_email.toLowerCase())
      .maybeSingle()
    customer = data as CustomerProfile | null
  } catch (err) {
    console.warn('[AdminOrderDetail] customers table not available yet:', err)
  }

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
              <Link
                href={`/order/${order.reference_code}`}
                target="_blank"
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Customer view ↗
              </Link>
              <a
                href={`/admin/api/orders/${order.id}/excel`}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Excel
              </a>
              <Link
                href={`/admin/orders/${order.id}/packing-slip`}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Packing slip ↗
              </Link>
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

        {/* Buyer discount */}
        {customer !== null && (
          customer.discount_percent > 0 ? (
            <section className="mb-6 rounded-xl bg-amber-50 border border-amber-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
                    Buyer Discount on File
                  </h2>
                  <p className="mt-1 text-2xl font-bold text-amber-900">
                    {customer.discount_percent}% off
                  </p>
                  <p className="mt-0.5 text-sm text-amber-700">
                    Discounted subtotal:{' '}
                    <span className="font-semibold">
                      {formatPrice(Math.round(order.subtotal_cents * (1 - customer.discount_percent / 100)))}
                    </span>
                    {' '}(save {formatPrice(Math.round(order.subtotal_cents * customer.discount_percent / 100))})
                  </p>
                  {customer.notes && (
                    <p className="mt-2 text-xs text-amber-600 italic">{customer.notes}</p>
                  )}
                </div>
                <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                  Apply in QuickBooks
                </span>
              </div>
            </section>
          ) : (
            <section className="mb-6 rounded-xl bg-gray-50 border border-gray-200 p-4">
              <p className="text-sm text-gray-500">
                Known customer: <span className="font-medium text-gray-700">{customer.name ?? order.customer_email}</span>
                {customer.company ? ` · ${customer.company}` : ''}
                {' '}· No discount on file.
              </p>
            </section>
          )
        )}

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
            <dt className="text-gray-500">Price tier</dt>
            <dd className="col-span-2 text-gray-900">
              {order.applied_tier_code ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                    {tierLabel(order.applied_tier_code)}
                  </span>
                  {order.applied_tier_discount_percent != null && order.applied_tier_discount_percent !== 0 && (
                    <span className="text-xs text-gray-500">
                      ({formatTierAdjustment(order.applied_tier_discount_percent)})
                    </span>
                  )}
                </span>
              ) : (
                '—'
              )}
            </dd>
            <dt className="text-gray-500">PO number</dt>
            <dd className="col-span-2 text-gray-900">{order.po_number || '—'}</dd>
            <dt className="text-gray-500">Ship to</dt>
            <dd className="col-span-2 text-gray-900">
              {order.ship_address1 ? (
                <>
                  {order.ship_address1}
                  {order.ship_address2 ? <>, {order.ship_address2}</> : null}
                  <br />
                  {order.ship_city}, {order.ship_state} {order.ship_zip}
                </>
              ) : (
                '—'
              )}
            </dd>
          </dl>
          {order.notes && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{order.notes}</p>
            </div>
          )}
          {customer === null && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <a
                href={`/admin/customers?prefill=${encodeURIComponent(JSON.stringify({ email: order.customer_email, name: order.customer_name, company: order.customer_company ?? '' }))}`}
                className="text-xs text-red-600 hover:text-red-700 underline"
              >
                + Save to customer profiles
              </a>
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
