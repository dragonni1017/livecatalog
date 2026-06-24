import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminClient } from '@/lib/supabase'
import PrintButton from '@/components/admin/PrintButton'
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

interface PrintPageProps {
  params: Promise<{ id: string }>
}

// Print-optimized sales order, one per order request. The worker prints it (or
// saves as PDF from the browser dialog) and keys it into QuickBooks Desktop.
export default async function SalesOrderPrintPage({ params }: PrintPageProps) {
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
  const totalUnits = items.reduce((sum, it) => sum + it.qty, 0)

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-gray-900 print:max-w-none print:p-0">
      {/* Toolbar — hidden when printing */}
      <div className="mb-8 flex items-center justify-between print:hidden">
        <Link href={`/admin/orders/${order.id}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to order
        </Link>
        <PrintButton />
      </div>

      {/* Document header */}
      <header className="flex items-start justify-between border-b-2 border-gray-900 pb-4">
        <div>
          <h1 className="text-xl font-bold">L &amp; Y USA</h1>
          <p className="text-sm text-gray-600">3183 Bandini Blvd, Vernon, CA 90058</p>
          <p className="text-sm text-gray-600">626-552-4120 · www.ly-usa.com</p>
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-bold uppercase tracking-wide">Sales Order</h2>
          <p className="mt-1 font-mono text-sm">{order.reference_code}</p>
          <p className="text-sm text-gray-600">{formatDate(order.created_at)}</p>
        </div>
      </header>

      {/* Customer */}
      <section className="mt-6">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Customer</h3>
        <p className="font-semibold">{order.customer_name}</p>
        {order.customer_company && <p className="text-sm">{order.customer_company}</p>}
        <p className="text-sm">{order.customer_email}</p>
        {order.customer_phone && <p className="text-sm">{order.customer_phone}</p>}
      </section>

      {/* Items */}
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-gray-300 text-left">
            <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-gray-500">SKU</th>
            <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Item</th>
            <th className="py-2 pr-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Unit</th>
            <th className="py-2 pr-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Qty</th>
            <th className="py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-gray-100 align-top">
              <td className="py-2 pr-3 font-mono text-xs">{it.sku}</td>
              <td className="py-2 pr-3">{it.name}</td>
              <td className="py-2 pr-3 text-right">{formatPrice(it.unit_price_cents)}</td>
              <td className="py-2 pr-3 text-right">{it.qty}</td>
              <td className="py-2 text-right font-semibold">{formatPrice(it.line_total_cents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-900">
            <td className="py-2 pr-3 text-xs text-gray-500" colSpan={3}>
              {items.length} line{items.length === 1 ? '' : 's'} · {totalUnits} unit{totalUnits === 1 ? '' : 's'}
            </td>
            <td className="py-2 pr-3 text-right text-sm font-semibold text-gray-600">Subtotal</td>
            <td className="py-2 text-right text-base font-bold">{formatPrice(order.subtotal_cents)}</td>
          </tr>
        </tfoot>
      </table>

      {order.notes && (
        <section className="mt-6">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</h3>
          <p className="whitespace-pre-wrap text-sm text-gray-700">{order.notes}</p>
        </section>
      )}

      <p className="mt-10 border-t border-gray-200 pt-3 text-xs text-gray-400">
        Quote request — prices and availability are confirmed by L &amp; Y USA before invoicing.
      </p>
    </div>
  )
}
