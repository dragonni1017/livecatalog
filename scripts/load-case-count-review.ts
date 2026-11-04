// load-case-count-review.ts
// Run with: node scripts/load-case-count-review.ts <Case_Count_Change_Report.xlsx> <batch>            (dry run)
//           node scripts/load-case-count-review.ts <Case_Count_Change_Report.xlsx> <batch> --apply
//
// Loads the "Case Count Changes" sheet of the case-count change report
// (shipment history vs the QuickBooks item list) into case_count_review_items
// (migration 0072) for /admin/case-count-review. It renames NOTHING: that
// happens on the screen. A product is loaded only when it is active, its
// name has a pack spec, and that spec's pieces per case differ from the
// latest shipment's. Every source goes in as evidence; none is picked.
// Re-running is safe: (batch, product_id) is unique, existing rows are kept.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { casePiecesOf, type CaseCountEvidence } from '../lib/case-count-review.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const str = (v: unknown) => String(v ?? '').trim()
const whole = (v: unknown) => {
  const n = Number(str(v))
  return Number.isInteger(n) && n > 0 ? n : null
}

const [sheetArg, batch] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const APPLY = process.argv.includes('--apply')
if (!sheetArg || !batch) {
  console.error('Usage: node scripts/load-case-count-review.ts <report.xlsx> <batch> [--apply]')
  process.exitCode = 1
} else {
  const wb = XLSX.read(fs.readFileSync(path.resolve(sheetArg)))
  const sheet = wb.Sheets['Case Count Changes']
  if (!sheet) throw new Error('No "Case Count Changes" sheet')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  // Case-insensitive: the report spells "P273647-60CM" where the catalog has
  // "P273647-60cm", and `.in()` is exact. Paged by id (stable).
  const bySku = new Map<string, { id: string; sku: string; name: string; is_active: boolean }>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('products').select('id, sku, name, is_active').order('id').range(from, from + 999)
    if (error) throw error
    for (const p of data ?? []) if (p.sku) bySku.set(p.sku.toUpperCase(), p)
    if (!data || data.length < 1000) break
  }

  const skipped: Record<string, string[]> = { 'not in the catalog': [], inactive: [], 'no pack spec': [], 'name already matches the latest shipment': [], 'no latest count': [] }
  const seen = new Set<string>()
  // Every row carries every key (supabase-js sends one column list for the batch).
  const items: Record<string, unknown>[] = []
  for (const r of rows) {
    const latestSku = str(r['Latest SKU spelling']) || str(r['Base SKU'])
    const p = bySku.get(latestSku.toUpperCase()) ?? bySku.get(str(r['Base SKU']).toUpperCase())
    if (!p) { skipped['not in the catalog'].push(latestSku); continue }
    if (seen.has(p.id)) continue
    seen.add(p.id)
    if (!p.is_active) { skipped.inactive.push(p.sku); continue }
    const current = casePiecesOf(p.name)
    if (current == null) { skipped['no pack spec'].push(p.sku); continue }
    const latest = whole(r['New Case Count (pc/cs)'])
    if (latest == null) { skipped['no latest count'].push(p.sku); continue }
    if (latest === current) { skipped['name already matches the latest shipment'].push(p.sku); continue }

    const evidence: CaseCountEvidence[] = [
      {
        source: 'Latest shipment',
        count: latest,
        detail: [str(r['Latest ETD Date']) && `ETD ${str(r['Latest ETD Date'])}`, str(r['New Shipment (carton batch)']), str(r['New Container #'])].filter(Boolean).join(', '),
      },
    ]
    if (str(r['Prior Case Count(s)'])) {
      evidence.push({
        source: 'Earlier shipments',
        count: null,
        detail: `${str(r['Prior Case Count(s)'])}${str(r['Prior Shipment Date(s)']) ? ` (ETD ${str(r['Prior Shipment Date(s)'])})` : ''}`,
      })
    }
    const qbRaw = str(r['QBD Description Case Count'])
    if (qbRaw) {
      evidence.push({ source: 'QuickBooks', count: whole(qbRaw), detail: whole(qbRaw) ? `${str(r['QBD Status'])}`.trim() : `"${qbRaw}" ${str(r['QBD Status'])}`.trim() })
    }
    items.push({
      batch,
      product_id: p.id,
      sku: p.sku,
      current_name: p.name,
      current_case_pieces: current,
      evidence,
      reason: str(r.Flag),
    })
  }

  console.log(`${APPLY ? 'APPLYING' : '[DRY RUN]'} batch "${batch}": ${items.length} rows to load`)
  for (const [why, skus] of Object.entries(skipped)) if (skus.length) console.log(`  left out, ${why} (${skus.length}): ${skus.join(', ')}`)
  for (const it of items.slice(0, 5)) console.log(`  e.g. ${it.sku}: name ${it.current_case_pieces}, ${(it.evidence as CaseCountEvidence[]).map((e) => `${e.source} ${e.count ?? e.detail}`).join('; ')}`)

  if (APPLY && items.length) {
    const { error: insErr } = await db.from('case_count_review_items').upsert(items, { onConflict: 'batch,product_id', ignoreDuplicates: true })
    if (insErr) throw insErr
    const { data: check, error: checkErr } = await db.from('case_count_review_items').select('id, status').eq('batch', batch)
    if (checkErr) throw checkErr
    console.log(`batch "${batch}" now has ${check.length} rows (${check.filter((c) => c.status === 'pending').length} to decide)`)
  }
}
