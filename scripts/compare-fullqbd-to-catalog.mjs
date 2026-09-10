// compare-fullqbd-to-catalog.mjs
// Run with: node scripts/compare-fullqbd-to-catalog.mjs
//
// Read-only. Cross-references every row in
// Downloads/FullQBDList09042026-sku-fixed.xlsx (QuickBooks Desktop's full
// Item List export, AFTER fix-fullqbd-sku-prefixes.mjs stripped the 813
// QB parent-item word-prefixes like "Backpack:" off the Item/SKU column --
// see that script's header for detail) against this catalog's Supabase
// `products` table, matched by SKU first, then barcode as a fallback --
// same two-key matching approach used earlier this session for the
// arrival-list cross-check. For every match, places QBD's and the
// catalog's name/description side by side so a mismatch (wrong translation,
// stale name, wrong pack spec, etc.) is easy to spot in one pass, rather
// than trusting either source blind.
//
// An earlier run of this same script (before the prefix fix existed) wrote
// data/qbd-catalog-compare/qbd-vs-catalog-comparison.xlsx against the RAW
// export -- that file is stale (813 real SKU matches were missed because of
// the unstripped prefix, and it may have run against an even earlier
// version of the source file that later got resaved with fewer rows).
// This run writes to a differently-named file so the stale one is never
// silently overwritten.
//
// Writes a NEW xlsx (never touches the source files or Supabase) to
// data/qbd-catalog-compare/qbd-vs-catalog-comparison-v2-sku-fixed.xlsx, one
// row per QBD item, columns:
//   qbd_sku, qbd_barcode, qbd_description, qbd_price, qbd_category,
//   match_type (sku / barcode / none), catalog_sku, catalog_name,
//   catalog_price, catalog_category, name_matches (yes/no/n-a),
//   flag (short human-readable note on what to check)
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const QBD_PATH = 'C:\\Users\\Dragon\\Downloads\\FullQBDList09042026-sku-fixed.xlsx'
const OUT_DIR = path.join(ROOT, 'data', 'qbd-catalog-compare')
const OUT_XLSX = path.join(OUT_DIR, 'qbd-vs-catalog-comparison-v2-sku-fixed.xlsx')

// ── Load QBD export ──────────────────────────────────────────────────────

function loadQbdRows() {
  const wb = XLSX.readFile(QBD_PATH)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { defval: null })
  return rows
    .filter((r) => r.Type === 'Inventory Part' || r.Type === 'Inventory Assembly')
    .map((r) => ({
      sku: String(r.Item || '').trim(),
      barcode: String(r.Barcode || '').trim(),
      description: String(r.Description || '').trim(),
      price: Number(r.Price) || 0,
      category: String(r.Category || '').trim(),
    }))
    .filter((r) => r.sku)
}

// ── Load full Supabase catalog, paginated past the 1000-row cap ─────────

async function loadCatalog() {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('sku, barcode, name, price_cents, category:categories!products_category_id_fkey(name)')
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

// ── Simple name-similarity check, not a strict diff ──────────────────────
// Lowercases, strips punctuation/pack-spec noise, and checks whether the
// shorter of the two names' significant words are mostly present in the
// longer one -- good enough to separate "basically the same, maybe
// reworded" from "clearly a different product," without pulling in a
// fuzzy-matching dependency this repo doesn't already use.
function normalizeForCompare(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\d+\s*\/\s*pk\b.*$/i, '') // drop pack-spec suffix entirely
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
}

function namesRoughlyMatch(a, b) {
  const wordsA = new Set(normalizeForCompare(a))
  const wordsB = new Set(normalizeForCompare(b))
  if (wordsA.size === 0 || wordsB.size === 0) return false
  const [shorter, longer] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA]
  let overlap = 0
  for (const w of shorter) if (longer.has(w)) overlap++
  return overlap / shorter.size >= 0.5
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('Reading QBD export...')
  const qbdRows = loadQbdRows()
  console.log(`  ${qbdRows.length} Inventory Part/Assembly rows`)

  console.log('Loading full Supabase catalog...')
  const catalog = await loadCatalog()
  console.log(`  ${catalog.length} products`)

  const bySku = new Map()
  const byBarcode = new Map()
  for (const p of catalog) {
    const sku = (p.sku || '').trim().toUpperCase()
    if (sku) bySku.set(sku, p)
    const barcode = (p.barcode || '').trim()
    if (barcode) byBarcode.set(barcode, p)
  }

  const results = []
  let matchedBySku = 0, matchedByBarcode = 0, noMatch = 0
  let nameMismatches = 0

  for (const q of qbdRows) {
    const skuKey = q.sku.toUpperCase()
    let matched = bySku.get(skuKey)
    let matchType = matched ? 'sku' : null

    if (!matched && q.barcode) {
      matched = byBarcode.get(q.barcode)
      if (matched) matchType = 'barcode'
    }

    if (matched) {
      if (matchType === 'sku') matchedBySku++
      else matchedByBarcode++
    } else {
      noMatch++
    }

    const catalogName = matched?.name ?? ''
    const nameMatch = !matched ? 'n/a' : namesRoughlyMatch(q.description, catalogName) ? 'yes' : 'no'
    if (matched && nameMatch === 'no') nameMismatches++

    const flags = []
    if (!matched) flags.push('no catalog match by SKU or barcode')
    if (matchType === 'barcode') flags.push('matched by barcode only -- QBD SKU differs from catalog SKU, verify same product')
    if (nameMatch === 'no') flags.push('name/description looks substantially different -- review')

    results.push({
      qbd_sku: q.sku,
      qbd_barcode: q.barcode,
      qbd_description: q.description,
      qbd_price: q.price,
      qbd_category: q.category,
      match_type: matchType ?? 'none',
      catalog_sku: matched?.sku ?? '',
      catalog_name: catalogName,
      catalog_price: matched ? (matched.price_cents / 100).toFixed(2) : '',
      catalog_category: matched?.category?.name ?? '',
      name_matches: nameMatch,
      flag: flags.join(' | '),
    })
  }

  console.log(`\n=== Summary ===`)
  console.log(`QBD items:                 ${qbdRows.length}`)
  console.log(`Matched by SKU:            ${matchedBySku}`)
  console.log(`Matched by barcode only:   ${matchedByBarcode}`)
  console.log(`No catalog match at all:   ${noMatch}`)
  console.log(`Matched but name differs:  ${nameMismatches}`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const ws = XLSX.utils.json_to_sheet(results)
  ws['!cols'] = [
    { wch: 16 }, { wch: 16 }, { wch: 45 }, { wch: 10 }, { wch: 18 },
    { wch: 12 }, { wch: 16 }, { wch: 45 }, { wch: 12 }, { wch: 18 },
    { wch: 12 }, { wch: 55 },
  ]
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'QBD vs Catalog')
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${results.length} rows to ${path.relative(ROOT, OUT_XLSX)}`)
}

main().catch((err) => { console.error('Fatal error:', err); process.exit(1) })
