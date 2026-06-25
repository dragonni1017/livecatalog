import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getAdminClient } from '@/lib/supabase'
import type { OrderItemRecord, OrderRequest } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Lives under /admin, so middleware gates it behind the admin cookie.

function dollars(cents: number): number {
  return Number((cents / 100).toFixed(2))
}

// GET /admin/api/orders/<id>/excel — one sales order as an .xlsx file:
// a header block (order + customer details) followed by the line-item table.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const db = getAdminClient()

    const { data: order } = await db
      .from('order_requests')
      .select('*')
      .eq('id', id)
      .single<OrderRequest>()
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    const { data: itemData } = await db
      .from('order_items')
      .select('*')
      .eq('order_id', id)
      .order('sku')
    const items = (itemData ?? []) as OrderItemRecord[]

    // Build the sheet as an array of rows (arrays). Header block, then a blank
    // row, then the line-item table with a subtotal.
    const rows: (string | number)[][] = [
      ['L & Y USA — Sales Order'],
      ['Reference', order.reference_code],
      ['Date', order.created_at ? new Date(order.created_at).toLocaleString('en-US') : ''],
      ['Status', order.status],
      ['Entered in QuickBooks', order.entered_in_qb ? 'yes' : 'no'],
      [],
      ['Customer', order.customer_name],
      ['Company', order.customer_company ?? ''],
      ['Email', order.customer_email],
      ['Phone', order.customer_phone ?? ''],
      ['Placed by (rep)', order.placed_by_rep ?? ''],
      ['PO #', order.po_number ?? ''],
      ['Notes', order.notes ?? ''],
      [],
      ['SKU', 'Item', 'Unit Price', 'Qty', 'Line Total'],
      ...items.map((it) => [it.sku, it.name, dollars(it.unit_price_cents), it.qty, dollars(it.line_total_cents)]),
      [],
      ['', '', '', 'Subtotal', dollars(order.subtotal_cents)],
    ]

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 16 }, { wch: 48 }, { wch: 12 }, { wch: 8 }, { wch: 12 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sales Order')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${order.reference_code}.xlsx"`,
      },
    })
  } catch (err) {
    console.error('[admin/orders/excel] error:', err)
    return NextResponse.json({ error: 'Excel export failed' }, { status: 500 })
  }
}
