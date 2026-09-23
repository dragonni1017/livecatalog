import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Lives under /admin, so middleware gates it behind the admin cookie.

// GET /admin/api/shipments/<id> — one staged shipment with its lines.
//
// The list GET on ../route.ts deliberately returns shipments WITHOUT lines,
// so before this route the only way to populate the receiving screen's
// working view was to re-drop the workbook: handleFile needs a File. That
// was safe (../route.ts dedupes on file_hash and reopens the existing
// shipment) but undiscoverable — the history table looked inert.
//
// Read-only. Applying stock stays on ./apply/route.ts, which re-reads the
// lines server-side, so nothing here can be used to bypass its gates.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const db = getAdminClient()

    const { data: shipment, error } = await db
      .from('shipments')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!shipment) return NextResponse.json({ error: 'Shipment not found.' }, { status: 404 })

    const { data: lines } = await db
      .from('shipment_lines')
      .select('*')
      .eq('shipment_id', id)
      .order('sku')

    // `problems` and `unitNote` describe a parse that isn't happening here —
    // they belong to the upload that staged this shipment and aren't stored.
    // Returned empty/null so the caller can set the same state either way.
    return NextResponse.json({
      shipment,
      lines: lines ?? [],
      problems: [],
      unitNote: null,
    })
  } catch (err) {
    console.error('[admin/shipments/[id] GET] error:', err)
    return NextResponse.json({ error: 'Failed to load that shipment.' }, { status: 500 })
  }
}
