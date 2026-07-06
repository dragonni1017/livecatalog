import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminClient } from '@/lib/supabase'
import PrintButton from '@/components/admin/PrintButton'
import type { OrderItemRecord, OrderRequest } from '@/lib/types'

export const dynamic = 'force-dynamic'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function PackingSlipPage({ params }: Props) {
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
          <h2 className="text-2xl font-bold uppercase tracking-wide">Packing Slip</h2>
          <p className="mt-1 font-mono text-sm">{order.reference_code}</p>
          <p className="text-sm text-gray-600">{formatDate(order.created_at)}</p>
          {order.po_number && <p className="text-sm text-gray-600">PO #: {order.po_number}</p>}
        </div>
      </header>

      {/* Ship to */}
      <section className="mt-6">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Ship To</h3>
        <p className="font-semibold">{order.customer_name}</p>
        {order.customer_company && <p className="text-sm">{order.customer_company}</p>}
        <p className="text-sm">{order.customer_email}</p>
        {order.customer_phone && <p className="text-sm">{order.customer_phone}</p>}
      </section>

      {/* Items — no prices, checkbox column for picker */}
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-gray-300 text-left">
            <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-gray-500">✓</th>
            <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-gray-500">SKU</th>
            <th className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Item</th>
            <th className="py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Qty</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-gray-100 align-top">
              <td className="py-3 pr-3">
                <span className="inline-block h-4 w-4 rounded border border-gray-400 print:border-gray-600" />
              </td>
              <td className="py-3 pr-3 font-mono text-xs">{it.sku}</td>
              <td className="py-3 pr-3">{it.name}</td>
              <td className="py-3 text-right font-semibold">{it.qty}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-900">
            <td colSpan={3} className="py-2 text-xs text-gray-500">
              {items.length} line{items.length === 1 ? '' : 's'}
            </td>
            <td className="py-2 text-right font-bold">{totalUnits} units</td>
          </tr>
        </tfoot>
      </table>

      {order.notes && (
        <section className="mt-6">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</h3>
          <p className="whitespace-pre-wrap text-sm text-gray-700">{order.notes}</p>
        </section>
      )}

      {/* Signature line */}
      <div className="mt-10 grid grid-cols-2 gap-8 border-t border-gray-200 pt-6 text-sm print:mt-16">
        <div>
          <p className="mb-6 text-xs text-gray-500">Packed by</p>
          <div className="border-b border-gray-400" />
        </div>
        <div>
          <p className="mb-6 text-xs text-gray-500">Checked by</p>
          <div className="border-b border-gray-400" />
        </div>
      </div>
    </div>
  )
}
