// load-name-review.ts
// Run with: node scripts/load-name-review.ts <sheet.xlsx> <batch>            (dry run)
//           node scripts/load-name-review.ts <sheet.xlsx> <batch> --apply
//
// Loads the "Name fixes" rows of the owner's review workbook
// (scripts/plan-owner-name-review.ts) into name_review_items (migration 0071)
// for /admin/name-review. It renames NOTHING: renaming happens on the screen.
// A row whose live name no longer equals the sheet's "Current name" is left
// out and listed, since the screen's rename guard would refuse it anyway.
// Re-running is safe: (batch, product_id) is unique, existing rows are kept.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const [sheetArg, batch] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const APPLY = process.argv.includes('--apply')
if (!sheetArg || !batch) {
  console.error('Usage: node scripts/load-name-review.ts <sheet.xlsx> <batch> [--apply]')
  process.exitCode = 1
} else {
  const wb = XLSX.read(fs.readFileSync(path.resolve(sheetArg)))
  const sheet = wb.Sheets['Name fixes']
  if (!sheet) throw new Error('No "Name fixes" sheet')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const skus = [...new Set(rows.map((r) => String(r.SKU).trim()))]
  const { data: products, error } = await db.from('products').select('id, sku, name').in('sku', skus)
  if (error) throw error
  const bySku = new Map(products.map((p) => [p.sku, p]))

  const missing: string[] = []
  const moved: string[] = []
  const seen = new Set<string>()
  // Every row carries every key (supabase-js sends one column list for the batch).
  const items: Record<string, unknown>[] = []
  for (const r of rows) {
    const sku = String(r.SKU).trim()
    const p = bySku.get(sku)
    if (!p) { missing.push(sku); continue }
    if (seen.has(p.id)) continue
    seen.add(p.id)
    const sheetName = String(r['Current name'] ?? '')
    if (p.name !== sheetName) { moved.push(sku); continue }
    const suggested = String(r['Suggested name'] ?? '').trim()
    items.push({
      batch,
      product_id: p.id,
      sku,
      problem: String(r.Problem ?? '').trim(),
      reason: String(r['What we found'] ?? '').trim(),
      current_name: p.name,
      suggested_name: suggested || null,
    })
  }

  console.log(`${APPLY ? 'APPLYING' : '[DRY RUN]'} batch "${batch}": ${items.length} rows to load (${items.filter((i) => i.suggested_name).length} with a suggestion)`)
  if (missing.length) console.log(`  not in the catalog (${missing.length}): ${missing.join(', ')}`)
  if (moved.length) console.log(`  name changed since the sheet, left out (${moved.length}): ${moved.join(', ')}`)

  if (APPLY && items.length) {
    const { error: insErr } = await db.from('name_review_items').upsert(items, { onConflict: 'batch,product_id', ignoreDuplicates: true })
    if (insErr) throw insErr
    const { data: check, error: checkErr } = await db.from('name_review_items').select('id, status').eq('batch', batch)
    if (checkErr) throw checkErr
    console.log(`batch "${batch}" now has ${check.length} rows (${check.filter((c) => c.status === 'pending').length} to decide)`)
  }
}
