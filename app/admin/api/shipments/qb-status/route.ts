import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { resolveSkus, type SkuResolution } from '@/lib/qb-item-directory'

export const dynamic = 'force-dynamic'

// GET ?shipment_id= — is each new (not-in-catalog) SKU on this shipment in
// QuickBooks Desktop? Read-only, against the qb_item_directory mirror that
// /admin/quickbooks/items pulls. Same resolver as that page's "Fill names",
// so the two screens can't disagree about a SKU.
//
// Lives under /admin, so middleware.ts already gates it behind the admin role.

export interface QbLineStatus {
  problem: SkuResolution['problem'] | null
  description: string | null
  /** QuickBooks sales price, for reference only; null when absent or $0. */
  salesPrice: number | null
}

export async function GET(request: NextRequest) {
  const shipmentId = request.nextUrl.searchParams.get('shipment_id')
  if (!shipmentId) return NextResponse.json({ error: 'Missing shipment_id' }, { status: 400 })
  try {
    const db = getAdminClient()
    const { data: lines, error } = await db
      .from('shipment_lines')
      .select('sku, pieces_per_case, match_status, erply_created_product_id')
      .eq('shipment_id', shipmentId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const wanted = new Map<string, { sku: string; piecesPerCase: number | null }>()
    for (const l of lines ?? []) {
      if (l.match_status === 'matched' && !l.erply_created_product_id) continue
      wanted.set(String(l.sku).toUpperCase(), {
        sku: String(l.sku),
        piecesPerCase: l.pieces_per_case == null ? null : Number(l.pieces_per_case),
      })
    }
    const { count: directorySize } = await db
      .from('qb_item_directory')
      .select('qb_item_list_id', { count: 'exact', head: true })

    const status: Record<string, QbLineStatus> = {}
    if (wanted.size > 0) {
      for (const r of await resolveSkus(db, [...wanted.values()])) {
        status[r.sku.toUpperCase()] = {
          problem: r.problem ?? null,
          // First line only: the rest is carton size and weight.
          description: r.match?.sales_desc?.split('\n')[0].trim() ?? null,
          salesPrice: Number(r.match?.sales_price) > 0 ? Number(r.match!.sales_price) : null,
        }
      }
    }
    // A null count with no error means the HEAD query failed (see CLAUDE.md),
    // so only an actual 0 says the mirror is empty.
    return NextResponse.json({ status, directoryEmpty: directorySize === 0 })
  } catch (err) {
    console.error('[admin/shipments/qb-status GET] error:', err)
    return NextResponse.json({ error: 'Could not check QuickBooks.' }, { status: 500 })
  }
}
