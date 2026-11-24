import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { findErplyCodes, isConfigured as isErplyConfigured } from '@/lib/erply'
import { fetchQbItemsBySku, resolveSkus } from '@/lib/qb-item-directory'
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

// The variant lookup (QuickBooks holds "F287760- FLOWER" for a bare F287760)
// is one query per SKU with no exact record, so it's capped like Erply's.
const MAX_QB_VARIANT_LOOKUPS = 250

/**
 * Upper-cased SKUs QuickBooks Desktop has, from the qb_item_directory mirror.
 * Same rule as Receiving's per-line status and QuickBooks → Items: an exact
 * record, or a suffixed variant (resolveSkus). Null when the mirror is empty,
 * so "never pulled" can't read as "nothing is in QuickBooks".
 */
async function findQbCodes(db: ReturnType<typeof getAdminClient>, keys: string[]): Promise<{ codes: Set<string>; variantsChecked: boolean } | null> {
  const { count, error } = await db.from('qb_item_directory').select('qb_item_list_id', { count: 'exact', head: true })
  // A HEAD count with no error and no count is a failed query (see CLAUDE.md).
  if (error || count == null) throw new Error(error?.message ?? 'could not read the QuickBooks item list')
  if (count === 0) return null

  const exact = await fetchQbItemsBySku(db, keys)
  const found = new Set(keys.filter((k) => exact.has(k)))
  const rest = keys.filter((k) => !found.has(k))
  if (rest.length <= MAX_QB_VARIANT_LOOKUPS) {
    for (const r of await resolveSkus(db, rest)) if (r.problem !== 'missing') found.add(r.sku.toUpperCase())
  }
  return { codes: found, variantsChecked: rest.length <= MAX_QB_VARIANT_LOOKUPS }
}

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

    let qbCodes: Set<string> | null = null
    let qbNote: string | null = null
    try {
      const qb = await findQbCodes(db, [...new Set(input.flatMap((c) => c.skus.map((s) => s.sku.trim().toUpperCase())))])
      qbCodes = qb?.codes ?? null
      if (qb && !qb.variantsChecked) qbNote = "Too many SKUs to check QuickBooks variant names (like \"F287760- FLOWER\") at once, so a few counted as not in QuickBooks may be there under a suffixed name. Check fewer containers to be sure."
      if (!qb) qbNote = 'The QuickBooks item list hasn’t been pulled yet (QuickBooks → Items), so SKUs weren’t checked against it.'
    } catch (e) {
      qbNote = `QuickBooks lookup failed: ${(e as Error).message}`
    }

    const report = buildContainerReport(input, catalog, (shipments ?? []) as ShipmentRefRow[], erplyCodes, qbCodes)
    return NextResponse.json({ ...report, erplyNote, qbNote })
  } catch (err) {
    console.error('[admin/shipments/check-containers] error:', err)
    return NextResponse.json({ error: 'Container check failed.' }, { status: 500 })
  }
}
