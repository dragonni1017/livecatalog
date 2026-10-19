export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { resolveCdnImage } from '@/lib/image'
import ReorderButton from '@/components/catalog/ReorderButton'
import PrintButton from '@/components/admin/PrintButton'

function formatPrice(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}
import OrderReplyForm from '@/components/catalog/OrderReplyForm'
import type { OrderStatus } from '@/lib/types'
import { getSessionUser } from '@/lib/auth-server'
import { canAccessOrder } from '@/lib/order-access'
import { orderTaxLine, TAX_ESTIMATE_NOTE } from '@/lib/sales-tax'

interface PageProps {
  params: Promise<{ reference: string }>
  searchParams: Promise<{ t?: string }>
}

// Shown both for a missing order and for one this visitor may not see, so the
// page can't be used to test which reference codes exist.
function SignInToView({ reference }: { reference: string }) {
  const from = `/order/${encodeURIComponent(reference)}`
  return (
    <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
      <h1 className="mb-2 text-lg font-semibold text-gray-900">Sign in to view this order</h1>
      <p className="mb-5 text-sm text-gray-600">
        Sign in with the email the order was placed with, or open the link in your most recent
        email about this order.
      </p>
      <Link
        href={`/login?from=${encodeURIComponent(from)}`}
        className="inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        Sign in
      </Link>
    </div>
  )
}

function statusBadge(status: OrderStatus) {
  switch (status) {
    case 'new':
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          Received
        </span>
      )
    case 'contacted':
      return (
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
          In Progress
        </span>
      )
    case 'converted':
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
          Confirmed
        </span>
      )
    case 'lost':
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
          Closed
        </span>
      )
  }
}

function statusDescription(status: OrderStatus): string {
  switch (status) {
    case 'new':
      return 'Your request is being reviewed by our team.'
    case 'contacted':
      return 'Our team has been in touch — check your email for updates.'
    case 'converted':
      return 'Your order has been confirmed and is being processed.'
    case 'lost':
      return 'This request has been closed.'
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default async function OrderPage({ params, searchParams }: PageProps) {
  const { reference } = await params
  const { t: token } = await searchParams
  const db = getAdminClient()

  const { data: order } = await db
    .from('order_requests')
    .select(
      'id, reference_code, status, customer_name, customer_email, customer_phone, customer_company, subtotal_cents, notes, placed_by_rep, po_number, created_at, entered_in_qb, access_token, rep_user_id, ship_address1, ship_address2, ship_city, ship_state, ship_zip, promo_code, promo_discount_cents, tax_state, tax_rate_percent, tax_estimate_cents, tax_exempt_reason',
    )
    .eq('reference_code', reference.toUpperCase())
    .single()

  // A reference is guessable, so it's never enough on its own. See
  // lib/order-access.ts. Missing and forbidden look the same.
  const user = await getSessionUser()
  if (!order || !canAccessOrder(order, { token, user })) {
    if (!reference || reference.length > 64) notFound()
    return <SignInToView reference={reference.toUpperCase()} />
  }

  const { data: items } = await db
    .from('order_items')
    .select('product_id, sku, name, unit_price_cents, qty, line_total_cents')
    .eq('order_id', order.id)
    .order('name')

  const lineItems = items ?? []

  const productIds = lineItems.map((i) => i.product_id).filter(Boolean) as string[]
  const { data: productRows } = productIds.length
    ? await db.from('products').select('id, image_url').in('id', productIds)
    : { data: [] }
  const imageById: Record<string, string | null> = {}
  for (const p of productRows ?? []) imageById[p.id] = p.image_url

  const reorderItems = lineItems.map((item) => ({
    productId: item.product_id as string | null,
    sku: item.sku,
    name: item.name,
    priceCents: item.unit_price_cents,
    qty: item.qty,
  }))

  const shipTo = order.ship_address1
    ? [
        order.ship_address1,
        order.ship_address2,
        [order.ship_city, [order.ship_state, order.ship_zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      ].filter(Boolean)
    : []

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <style>{'@page { size: letter; margin: 0.5in; }'}</style>

      {/* Print-only letterhead: the on-screen chrome (back link, buttons, reply form) is hidden in print. */}
      <div className="mb-4 hidden border-b-2 border-gray-900 pb-2 print:block">
        <p className="text-lg font-bold">L &amp; Y USA — Quote request</p>
        <p className="text-xs text-gray-600">626-552-4120 · www.ly-usa.com · Quote request; prices are confirmed by our team at fulfillment.</p>
      </div>

      {/* Back link */}
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 print:hidden"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
          />
        </svg>
        Back to catalog
      </Link>

      {/* Heading */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Order {order.reference_code}</h1>
        <div className="print:hidden">
          <PrintButton />
        </div>
      </div>

      {/* Status + date */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex items-center gap-2">
          {statusBadge(order.status as OrderStatus)}
          <span className="text-sm text-gray-600">
            {statusDescription(order.status as OrderStatus)}
          </span>
        </div>
        <div className="flex items-center gap-3 sm:ml-auto">
          {order.entered_in_qb && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
              </svg>
              Entered in our system
            </span>
          )}
          <span className="text-sm text-gray-400">
            Placed {formatDate(order.created_at)}
          </span>
        </div>
      </div>

      {/* Order details */}
      <div className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-white p-5 text-sm shadow-sm sm:grid-cols-2 print:shadow-none">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Customer</p>
          <p className="mt-1 text-gray-900">{order.customer_name}</p>
          {order.customer_company && <p className="text-gray-700">{order.customer_company}</p>}
          <p className="text-gray-600">{order.customer_email}</p>
          {order.customer_phone && <p className="text-gray-600">{order.customer_phone}</p>}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Ship to</p>
          {shipTo.length ? (
            shipTo.map((line, i) => (
              <p key={i} className={i === 0 ? 'mt-1 text-gray-900' : 'text-gray-700'}>
                {line}
              </p>
            ))
          ) : (
            <p className="mt-1 text-gray-500">—</p>
          )}
        </div>
        {order.po_number && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">PO number</p>
            <p className="mt-1 font-mono text-gray-900">{order.po_number}</p>
          </div>
        )}
        {order.notes && (
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</p>
            <p className="mt-1 whitespace-pre-wrap text-gray-700">{order.notes}</p>
          </div>
        )}
      </div>

      {/* Items table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <th className="px-3 py-3 w-12"></th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 hidden sm:table-cell">SKU</th>
              <th className="px-4 py-3 text-right">Unit Price</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lineItems.map((item) => (
              <tr key={item.sku} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  {item.product_id && imageById[item.product_id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolveCdnImage(imageById[item.product_id]!, 80) ?? undefined}
                      alt={item.name}
                      className="h-10 w-10 rounded object-contain bg-gray-50"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-gray-100" />
                  )}
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                <td className="px-4 py-3 font-mono text-gray-500 hidden sm:table-cell">{item.sku}</td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {formatPrice(item.unit_price_cents)}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">{item.qty}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">
                  {formatPrice(item.line_total_cents)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {order.promo_code && (
              <tr className="border-t border-gray-200 bg-gray-50">
                <td colSpan={5} className="px-4 pt-3 text-right text-sm text-green-700">
                  Promo {order.promo_code} savings (included in the line totals above)
                </td>
                <td className="px-4 pt-3 text-right text-sm text-green-700">
                  −{formatPrice(order.promo_discount_cents ?? 0)}
                </td>
              </tr>
            )}
            <tr className="border-t border-gray-200 bg-gray-50">
              <td colSpan={5} className="px-4 py-3 text-right text-sm font-medium text-gray-600">
                Subtotal
              </td>
              <td className="px-4 py-3 text-right text-base font-bold text-gray-900">
                {formatPrice(order.subtotal_cents)}
              </td>
            </tr>
            {(() => {
              const taxLine = orderTaxLine(order)
              if (!taxLine) return null
              return (
                <>
                  <tr className="bg-gray-50">
                    <td colSpan={5} className="px-4 pb-1 text-right text-sm text-gray-600">{taxLine.label}</td>
                    <td className="px-4 pb-1 text-right text-sm text-gray-700">{formatPrice(taxLine.cents)}</td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td colSpan={5} className="px-4 pb-3 text-right text-sm font-medium text-gray-600">
                      Estimated total
                      <div className="text-xs font-normal text-gray-500">{TAX_ESTIMATE_NOTE}</div>
                    </td>
                    <td className="px-4 pb-3 text-right text-base font-bold text-gray-900">
                      {formatPrice(order.subtotal_cents + taxLine.cents)}
                    </td>
                  </tr>
                </>
              )
            })()}
          </tfoot>
        </table>
      </div>

      {/* Reorder */}
      <div className="mt-6 print:hidden">
        <ReorderButton items={reorderItems} />
        <p className="mt-2 text-xs text-gray-500">
          Prices are confirmed by our team at time of fulfillment.
        </p>
      </div>

      {/* Customer reply */}
      <div className="print:hidden">
        <OrderReplyForm reference={order.reference_code} token={token ?? null} customerName={order.customer_name} />
      </div>

      <p className="mt-4 text-center text-xs text-gray-400 print:hidden">
        <Link href="/my-orders" className="hover:text-gray-600 underline">
          View all your orders →
        </Link>
      </p>
    </div>
  )
}
