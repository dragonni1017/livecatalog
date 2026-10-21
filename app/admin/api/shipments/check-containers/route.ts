import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { findErplyCodes, isConfigured as isErplyConfigured } from '@/lib/erply'
import {
  buildContainerReport,
  missingSkuKeys,
  type CatalogSkuRow,
  type ContainerSkus,
  type ShipmentRefRow,
} from '@/lib/container-check'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST { containers: ContainerSkus[] } -> ContainerReport.
//
// READ ONLY: reads products, shipments and Erply; writes nothing. The browser
// parses the supplier files (they live in OneDrive, not here) and sends just
// container refs and SKUs. See lib/container-check.ts.
//
// Lives under /admin, so middleware.ts already gates it behind the admin role.

const MAX_CONTAINERS = 60
const MAX_SKUS = 500
// One Erply call per missing SKU. Beyond this the check skips Erply rather
// than run into the function timeout; the catalog half still answers.
const MAX_ERPLY_LOOKUPS = 250

function readInput(body: unknown): ContainerSkus[] | string {
  const list = (body as { containers?: unknown })?.containers
  if (!Array.isArray(list) || !list.length) return 'No containers to check.'
  if (list.length > MAX_CONTAINERS) return `At most ${MAX_CONTAINERS} containers at a time.`
  const out: ContainerSkus[] = []
  for (const c of list) {
    const ref = typeof c?.ref === 'string' ? c.ref.trim() : ''
    if (!ref || !Array.isArray(c.skus) || c.skus.length > MAX_SKUS) return 'Malformed container entry.'
    const skus = c.skus
      .filter((s: unknown): s is { sku: string; pieces: number } => typeof (s as { sku?: unknown })?.sku === 'string')
      .map((s: { sku: string; pieces: unknown }) => ({ sku: s.sku.trim(), pieces: Number(s.pieces) || 0 }))
      .filter((s: { sku: string }) => s.sku)
    out.push({
      ref,
      etd: typeof c.etd === 'string' ? c.etd : '',
      file: typeof c.file === 'string' ? c.file : null,
      error: typeof c.error === 'string' ? c.error.slice(0, 300) : null,
      skus,
    })
  }
  return out
}

export async function POST(request: NextRequest) {
  try {
    const input = readInput(await request.json().catch(() => null))
    if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 400 })

    const db = getAdminClient()
    const catalog: CatalogSkuRow[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('products')
        .select('sku, is_active, manually_hidden')
        .order('id')
        .range(from, from + 999)
      if (error) return NextResponse.json({ error: `Could not read products: ${error.message}` }, { status: 500 })
      catalog.push(...(data as CatalogSkuRow[]))
      if (data.length < 1000) break
    }
    const { data: shipments, error: shipErr } = await db.from('shipments').select('container_ref, file_name, status')
    if (shipErr) return NextResponse.json({ error: `Could not read shipments: ${shipErr.message}` }, { status: 500 })

    const missing = missingSkuKeys(input, catalog)
    let erplyCodes: Set<string> | null = null
    let erplyNote: string | null = null
    if (!isErplyConfigured()) erplyNote = 'Erply isn’t configured here, so missing SKUs weren’t looked up in Erply.'
    else if (missing.length > MAX_ERPLY_LOOKUPS) erplyNote = `${missing.length} missing SKUs is too many to look up in Erply at once; check fewer containers.`
    else {
      try {
        erplyCodes = await findErplyCodes(missing)
      } catch (e) {
        erplyNote = `Erply lookup failed: ${(e as Error).message}`
      }
    }

    const report = buildContainerReport(input, catalog, (shipments ?? []) as ShipmentRefRow[], erplyCodes)
    return NextResponse.json({ ...report, erplyNote })
  } catch (err) {
    console.error('[admin/shipments/check-containers] error:', err)
    return NextResponse.json({ error: 'Container check failed.' }, { status: 500 })
  }
}
