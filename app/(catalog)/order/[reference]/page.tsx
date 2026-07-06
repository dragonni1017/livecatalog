export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { cdnImage } from '@/lib/image'
import ReorderButton from '@/components/catalog/ReorderButton'

function formatPrice(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}
import OrderReplyForm from '@/components/catalog/OrderReplyForm'
import type { OrderStatus } from '@/lib/types'

interface PageProps {
  params: Promise<{ reference: string }>
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

export default async function OrderPage({ params }: PageProps) {
  const { reference } = await params
  const db = getAdminClient()

  const { data: order } = await db
    .from('order_requests')
    .select(
      'id, reference_code, status, customer_name, customer_email, customer_phone, customer_company, subtotal_cents, notes, placed_by_rep, po_number, created_at, entered_in_qb',
    )
    .eq('reference_code', reference.toUpperCase())
    .single()

  if (!order) notFound()

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

  return (
    <div className="mx-auto max-w-3xl">
      {/* Back link */}
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
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
      <h1 className="mb-4 text-2xl font-bold text-gray-900">
        Order {order.reference_code}
      </h1>

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
                      src={cdnImage(imageById[item.product_id]!, 80) ?? undefined}
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
            <tr className="border-t border-gray-200 bg-gray-50">
              <td colSpan={5} className="px-4 py-3 text-right text-sm font-medium text-gray-600">
                Subtotal
              </td>
              <td className="px-4 py-3 text-right text-base font-bold text-gray-900">
                {formatPrice(order.subtotal_cents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Reorder */}
      <div className="mt-6">
        <ReorderButton items={reorderItems} />
        <p className="mt-2 text-xs text-gray-500">
          Prices are confirmed by our team at time of fulfillment.
        </p>
      </div>

      {/* Customer reply */}
      <OrderReplyForm reference={order.reference_code} customerName={order.customer_name} />

      <p className="mt-4 text-center text-xs text-gray-400">
        <Link href="/my-orders" className="hover:text-gray-600 underline">
          View all your orders →
        </Link>
      </p>
    </div>
  )
}
