import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Lives under /admin, so middleware already gates it behind the admin cookie.

interface ExportItem {
  sku: string
  name: string
  qty: number
  unit_price_cents: number
  line_total_cents: number
}
interface ExportOrder {
  reference_code: string
  created_at: string
  status: string
  entered_in_qb: boolean
  customer_name: string
  customer_company: string | null
  customer_email: string
  customer_phone: string | null
  placed_by_rep: string | null
  po_number: string | null
  subtotal_cents: number
  order_items: ExportItem[]
}

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  // Quote if it contains comma, quote, or newline; escape embedded quotes.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2)
}

// GET /admin/orders/export — one CSV row per order line item, newest first.
export async function GET() {
  try {
    const db = getAdminClient()
    const { data, error } = await db
      .from('order_requests')
      .select(
        'reference_code, created_at, status, entered_in_qb, customer_name, customer_company, customer_email, customer_phone, placed_by_rep, po_number, subtotal_cents, order_items(sku, name, qty, unit_price_cents, line_total_cents)',
      )
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) throw error

    const orders = (data ?? []) as ExportOrder[]
    const headers = [
      'Reference', 'Date', 'Status', 'Entered in QB', 'Customer', 'Company', 'Email', 'Phone',
      'Rep', 'PO #', 'SKU', 'Item', 'Qty', 'Unit Price', 'Line Total', 'Order Subtotal',
    ]
    const rows: string[] = [headers.join(',')]

    for (const o of orders) {
      const base = [
        o.reference_code,
        new Date(o.created_at).toISOString(),
        o.status,
        o.entered_in_qb ? 'yes' : 'no',
        o.customer_name,
        o.customer_company ?? '',
        o.customer_email,
        o.customer_phone ?? '',
        o.placed_by_rep ?? '',
        o.po_number ?? '',
      ]
      const items = o.order_items?.length ? o.order_items : [null]
      for (const it of items) {
        const line = [
          ...base,
          it?.sku ?? '',
          it?.name ?? '',
          it ? String(it.qty) : '',
          it ? dollars(it.unit_price_cents) : '',
          it ? dollars(it.line_total_cents) : '',
          dollars(o.subtotal_cents),
        ]
        rows.push(line.map(csvCell).join(','))
      }
    }

    const csv = rows.join('\r\n')
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orders-${stamp}.csv"`,
      },
    })
  } catch (err) {
    console.error('[admin/orders/export] error:', err)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
