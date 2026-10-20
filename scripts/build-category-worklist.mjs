// build-category-worklist.mjs
// Run with: node scripts/build-category-worklist.mjs
//           node scripts/build-category-worklist.mjs --all      (hidden products too)
//           node scripts/build-category-worklist.mjs --out=data/other.xlsx
//
// Read-only. Lists active products with no category_id -- by default only the
// visible ones, which are on the storefront but missing from every category
// page -- with a suggested category for each, as a fill-in-able xlsx.
// Review the "Category" column and hand the file to
// scripts/import-category-worklist.mjs to write it back.
//
// Run scripts/repair-category-id-from-join.mjs first if it reports anything:
// a product whose category is still in product_categories should be restored
// from there, not re-guessed here. (2026-10-20: none of the 141 visible ones
// had a join row.)
//
// Suggestions, strongest first; the Source column says which one fired:
//   erply    -- the live Erply group name, through lib/erply-category-aliases
//               .ts plus the same one-off overlay backfill-category-for-new-
//               products.mjs used, matched to an existing category. "Uncategor-
//               ized" and group names with no existing category don't count.
//   nearby   -- most categorized products within +/-50 of this SKU number
//               (same letter prefix) share one category: at least 3 of them
//               and at least 70%. SKUs are allocated in runs, so neighbours
//               are usually the same product line.
//   keyword  -- a word in the name (paper, ribbon, squishy, ...).
// Blank Category = no suggestion; fill it in by hand. The Categories sheet
// lists every valid name -- import refuses anything not on it.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
// Writes: data/category-worklist-<date>.xlsx (or --out). Writes nothing else.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const env = {}
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ERPLY_CLIENT_CODE', 'ERPLY_USERNAME', 'ERPLY_PASSWORD']) {
  env[k] = process.env[k]
  if (!env[k]) { console.error(`Missing in .env.local: ${k}`); process.exit(1) }
}

const INCLUDE_HIDDEN = process.argv.includes('--all')
const stamp = new Date().toISOString().slice(0, 10)
const outArg = process.argv.find((a) => a.startsWith('--out='))
const OUT = path.resolve(ROOT, outArg ? outArg.slice(6) : `data/category-worklist-${stamp}.xlsx`)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Erply group names ───────────────────────────────────────────────────────

const ERPLY_API_URL = `https://${env.ERPLY_CLIENT_CODE}.erply.com/api/`
let sessionKey = null
async function erplyPost(params) {
  if (!sessionKey) {
    const body = new URLSearchParams({ clientCode: env.ERPLY_CLIENT_CODE, request: 'verifyUser', username: env.ERPLY_USERNAME, password: env.ERPLY_PASSWORD })
    const json = await (await fetch(ERPLY_API_URL, { method: 'POST', body })).json()
    sessionKey = json.records[0].sessionKey
  }
  const body = new URLSearchParams({ clientCode: env.ERPLY_CLIENT_CODE, sessionKey, ...params })
  return (await fetch(ERPLY_API_URL, { method: 'POST', body })).json()
}

// Mirrors lib/erply-category-aliases.ts (scripts read it rather than import
// it, same as backfill-category-for-new-products.mjs), plus that script's
// one-off overlay reviewed with Dragon 2026-09-01.
function loadAliasMap() {
  const raw = fs.readFileSync(path.join(ROOT, 'lib', 'erply-category-aliases.ts'), 'utf8')
  const map = {}
  for (const m of raw.matchAll(/'([^']+)':\s*'([^']+)'/g)) map[m[1]] = m[2]
  return {
    ...map,
    Keychain: 'Keychains', TOY: 'Toys & Novelties', Stationary: 'Stationery & Office',
    pen: 'Stationery & Office', Ribbon: 'Ribbons', Backpack: 'Bags/Purses',
    'Bag/Purse': 'Bags/Purses', '3D': '3D Printed', 'Wrapping Paper': 'Papers',
    'Floral Papers': 'Papers', 'Gift Boxes': 'Gifts',
  }
}

// ── Keyword fallback ────────────────────────────────────────────────────────
// Checked in order; first hit wins. Only words that unambiguously name a
// product line -- anything vaguer is left blank for a human.
const KEYWORDS = [
  [/\bkey ?chains?\b/i, 'Keychains'],
  [/\bribbons?\b|\bribon\b/i, 'Ribbons'],
  [/\bsquish(y|ies)\b|\bslime\b/i, 'Toys & Novelties'],
  [/\b(wrapping|floral|solid|color) paper|\bpapers?\b/i, 'Papers'],
  [/\bbackpacks?\b|\bpurses?\b|\btote\b|\bwallet\b/i, 'Bags/Purses'],
  [/\bplush(ie)?\b/i, 'Plush'],
  [/\bcrowns?\b|\btiaras?\b/i, 'Crowns'],
  [/\bcandles?\b/i, 'Candles'],
  [/\bumbrellas?\b/i, 'Umbrella'],
  [/\bblankets?\b/i, 'Blankets'],
  [/\b(tumbler|mug|cups?)\b/i, 'Drinkware & Cups'],
  [/\b(eraser|notebook|pens?|pencil)\b/i, 'Stationery & Office'],
]

// ── Load ────────────────────────────────────────────────────────────────────

const { data: categories, error: ce } = await supabase.from('categories').select('id, name').order('name')
if (ce) throw new Error(`Supabase: ${ce.message}`)
const catByLower = new Map(categories.map((c) => [c.name.toLowerCase(), c]))
const catName = new Map(categories.map((c) => [c.id, c.name]))

const all = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name, category_id, is_active, manually_hidden, stock_qty')
    .order('id')
    .range(from, from + 999)
  if (error) throw new Error(`Supabase: ${error.message}`)
  all.push(...data)
  if (data.length < 1000) break
}
const targets = all.filter((p) => p.sku && p.is_active && !p.category_id && (INCLUDE_HIDDEN || !p.manually_hidden))
console.log(`${targets.length} ${INCLUDE_HIDDEN ? 'active' : 'visible'} products with no category`)

// SKU -> [prefix, number], e.g. F287975 -> ['F', 287975], FD400026 -> ['FD', 400026]
const parseSku = (sku) => {
  const m = /^([A-Za-z]+)(\d+)/.exec(sku.trim())
  return m ? [m[1].toUpperCase(), Number(m[2])] : null
}
const categorized = all.filter((p) => p.category_id && parseSku(p.sku))

function nearby(sku) {
  const me = parseSku(sku)
  if (!me) return null
  const counts = new Map()
  let n = 0
  for (const p of categorized) {
    const [pre, num] = parseSku(p.sku)
    if (pre !== me[0] || Math.abs(num - me[1]) > 50) continue
    counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1)
    n++
  }
  const [top, hits] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  if (!top || hits < 3 || hits / n < 0.7) return null
  return { name: catName.get(top), note: `${hits} of ${n} nearby ${me[0]} SKUs` }
}

const aliases = loadAliasMap()
console.log('Fetching Erply group names...')
const groupBySku = new Map()
for (const p of targets) {
  const json = await erplyPost({ request: 'getProducts', code: p.sku })
  const rec = json.records?.find((r) => (r.code ?? '').trim().toLowerCase() === p.sku.trim().toLowerCase())
  groupBySku.set(p.sku, (rec?.groupName ?? '').trim())
}

// ── Suggest ─────────────────────────────────────────────────────────────────

const rows = targets.map((p) => {
  const group = groupBySku.get(p.sku) ?? ''
  let suggestion = null
  const mapped = group && group !== 'Uncategorized' ? catByLower.get((aliases[group] ?? group).toLowerCase()) : null
  if (mapped) suggestion = { name: mapped.name, source: 'erply', note: `Erply group "${group}"` }
  if (!suggestion) {
    const nb = nearby(p.sku)
    if (nb) suggestion = { ...nb, source: 'nearby' }
  }
  if (!suggestion) {
    const hit = KEYWORDS.find(([re]) => re.test(p.name))
    if (hit && catByLower.has(hit[1].toLowerCase())) suggestion = { name: hit[1], source: 'keyword', note: `name matches ${hit[0].source.split('|')[0].replace(/\\b/g, '')}` }
  }
  return {
    SKU: p.sku,
    Name: p.name,
    'Erply Group': group,
    Stock: p.stock_qty ?? '',
    Visible: p.manually_hidden ? 'no' : 'yes',
    Source: suggestion?.source ?? '',
    Why: suggestion?.note ?? '',
    Category: suggestion?.name ?? '',
  }
})
const order = { erply: 0, nearby: 1, keyword: 2, '': 3 }
rows.sort((a, b) => order[a.Source] - order[b.Source] || a.Category.localeCompare(b.Category) || a.SKU.localeCompare(b.SKU))

// ── Write ───────────────────────────────────────────────────────────────────

const wb = XLSX.utils.book_new()
const ws = XLSX.utils.json_to_sheet(rows, { header: ['SKU', 'Name', 'Erply Group', 'Stock', 'Visible', 'Source', 'Why', 'Category'] })
ws['!cols'] = [{ wch: 16 }, { wch: 55 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 30 }, { wch: 24 }]
ws['!autofilter'] = { ref: ws['!ref'] }
XLSX.utils.book_append_sheet(wb, ws, 'Needs Category')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categories.map((c) => ({ Category: c.name }))), 'Categories')
fs.mkdirSync(path.dirname(OUT), { recursive: true })
XLSX.writeFile(wb, OUT)

const by = (k) => rows.filter((r) => r.Source === k).length
console.log(`\nSuggested: ${by('erply')} from Erply, ${by('nearby')} from nearby SKUs, ${by('keyword')} from the name; ${by('')} left blank`)
const tally = {}
for (const r of rows) tally[r.Category || '(blank)'] = (tally[r.Category || '(blank)'] ?? 0) + 1
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log(`\nWrote ${path.relative(ROOT, OUT)}`)
