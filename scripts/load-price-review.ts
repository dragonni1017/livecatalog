// load-price-review.ts
// Run with: node scripts/load-price-review.ts <sheet.xlsx> <batch>            (dry run)
//           node scripts/load-price-review.ts <sheet.xlsx> <batch> --apply
//
// Loads the "to decide" rows of a price review sheet into price_review_items
// (migration 0070) for /admin/price-review. It changes NO prices: approving
// happens on the screen. Re-running is safe: (batch, product_id) is unique and
// existing rows are left as they are.
//
// Expected sheet "Prices to review" columns (the review sheets built
// 2026-10-29): Status, Group, SKU, Note in file, Why, Suggested price,
// Website price now, Website price from file (base x 2.4, rounded).

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
  console.error('Usage: node scripts/load-price-review.ts <sheet.xlsx> <batch> [--apply]')
  process.exit(1)
}

const toCents = (v: unknown): number | null => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/^\$/, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

const wb = XLSX.read(fs.readFileSync(path.resolve(sheetArg)))
const sheet = wb.Sheets['Prices to review']
if (!sheet) throw new Error('No "Prices to review" sheet')
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  .filter((r) => String(r.Status ?? 'to decide').trim() === 'to decide')

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const skus = rows.map((r) => String(r.SKU).trim())
const { data: products, error } = await db.from('products').select('id, sku').in('sku', skus)
if (error) throw error
const idBySku = new Map(products.map((p) => [p.sku, p.id]))

const missing = skus.filter((s) => !idBySku.has(s))
// Every row carries every key (supabase-js sends one column list for the batch).
const items = rows
  .filter((r) => idBySku.has(String(r.SKU).trim()))
  .map((r) => ({
    batch,
    product_id: idBySku.get(String(r.SKU).trim())!,
    sku: String(r.SKU).trim(),
    grp: String(r.Group ?? ''),
    note: String(r['Note in file'] ?? '').trim(),
    reason: String(r.Why ?? '').trim(),
    file_cents: toCents(r['Website price from file (base x 2.4, rounded)']),
    website_cents: toCents(r['Website price now']),
    suggested_cents: toCents(r['Suggested price']),
  }))

console.log(`${APPLY ? 'APPLYING' : '[DRY RUN]'} batch "${batch}": ${items.length} rows to load, ${missing.length} SKUs not in the catalog${missing.length ? ': ' + missing.join(', ') : ''}`)
console.log(`  with a suggestion: ${items.filter((i) => i.suggested_cents != null).length}, without: ${items.filter((i) => i.suggested_cents == null).length}`)
// No process.exit() here: on Windows it can crash Node while fetch sockets are open.
if (APPLY) {
  const { error: insErr } = await db.from('price_review_items').upsert(items, { onConflict: 'batch,product_id', ignoreDuplicates: true })
  if (insErr) throw insErr
  const { data: check, error: checkErr } = await db.from('price_review_items').select('id, status').eq('batch', batch)
  if (checkErr) throw checkErr
  console.log(`batch "${batch}" now has ${check.length} rows (${check.filter((c) => c.status === 'pending').length} to decide)`)
}
