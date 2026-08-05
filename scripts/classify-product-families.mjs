// classify-product-families.mjs
// Run with: node scripts/classify-product-families.mjs
//
// Read-only classification report: groups every active Supabase product into
// families using two signals, so it's clear which SKUs look like
// color/size/style variants of a shared base product vs. genuinely
// standalone, individually-added items. Writes nothing to Supabase.
//
// Signals (in priority order):
//   barcode   - two or more active products share an identical barcode.
//               Strongest signal: same physical UPC almost always means
//               "same base product, different variant" (see
//               docs/memory/project-duplicate-barcode-families.md for the
//               one confirmed exception, F286606, which was a real
//               duplicate-listing bug, not a variant family).
//   sku-base  - product's SKU, with the trailing "-SUFFIX" segment removed,
//               matches another active product's SKU or SKU-base. Catches
//               variant families that don't share a barcode (each color has
//               its own UPC) but clearly share a base code, e.g. F286557-BU
//               / F286557-CL / F286557-CL / F286557-RD.
// A product with neither signal (no barcode sibling, no SKU-base sibling) is
// "standalone" -- genuinely its own thing, not a variant of anything else.
//
// This is a report only. It does not decide what SHOULD be true (e.g.
// whether a family should become a matrix-variant product) -- see
// docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md TODO #5 for that separate,
// narrower question about Erply-missing SKUs specifically. This script is
// catalog-wide and Erply-independent.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

config({ path: path.join(ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials in .env.local.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function selectAll(makeQuery) {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

function baseCode(sku) {
  const idx = sku.lastIndexOf('-')
  return idx > 0 ? sku.slice(0, idx) : sku
}

function csvEscape(value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Union-find so a product linked via EITHER signal ends up in one family,
// even if the barcode and sku-base signals would otherwise form separate
// overlapping groups.
class UnionFind {
  constructor() { this.parent = new Map() }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x)
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)
    let cur = x
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

async function main() {
  console.log('Loading active Supabase products...')
  const rows = await selectAll((from, to) =>
    supabase
      .from('products')
      .select('sku, name, barcode, price_cents, category_id, is_active')
      .eq('is_active', true)
      .range(from, to),
  )
  console.log(`  ${rows.length} active products`)

  const { data: categories } = await supabase.from('categories').select('id, name')
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c.name]))

  const uf = new UnionFind()
  for (const r of rows) uf.find(r.sku)

  // barcode signal
  const byBarcode = new Map()
  for (const r of rows) {
    if (!r.barcode) continue
    if (!byBarcode.has(r.barcode)) byBarcode.set(r.barcode, [])
    byBarcode.get(r.barcode).push(r.sku)
  }
  let barcodeLinks = 0
  for (const skus of byBarcode.values()) {
    if (skus.length < 2) continue
    for (let i = 1; i < skus.length; i++) { uf.union(skus[0], skus[i]); barcodeLinks++ }
  }

  // sku-base signal
  const byBase = new Map()
  for (const r of rows) {
    const b = baseCode(r.sku).toUpperCase()
    if (!byBase.has(b)) byBase.set(b, [])
    byBase.get(b).push(r.sku)
  }
  let baseLinks = 0
  for (const skus of byBase.values()) {
    if (skus.length < 2) continue
    for (let i = 1; i < skus.length; i++) { uf.union(skus[0], skus[i]); baseLinks++ }
  }

  const bySku = new Map(rows.map((r) => [r.sku, r]))
  const families = new Map() // root -> [sku,...]
  for (const r of rows) {
    const root = uf.find(r.sku)
    if (!families.has(root)) families.set(root, [])
    families.get(root).push(r.sku)
  }

  const familyRows = []
  const familyList = [...families.values()].sort((a, b) => b.length - a.length)
  let standaloneCount = 0
  let familyCount = 0
  let familyMemberCount = 0

  for (const members of familyList) {
    const isFamily = members.length > 1
    if (isFamily) { familyCount++; familyMemberCount += members.length } else { standaloneCount++ }
    for (const sku of members.sort()) {
      const r = bySku.get(sku)
      familyRows.push({
        familyId: isFamily ? `fam-${members.slice().sort()[0]}` : '',
        classification: isFamily ? 'family-member' : 'standalone',
        familySize: members.length,
        sku,
        name: r.name,
        barcode: r.barcode ?? '',
        price: ((r.price_cents ?? 0) / 100).toFixed(2),
        category: categoryById.get(r.category_id) ?? '',
      })
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Total active products: ${rows.length}`)
  console.log(`Families (2+ related SKUs): ${familyCount} families, ${familyMemberCount} member products`)
  console.log(`Standalone (no related SKU found): ${standaloneCount}`)
  console.log(`(barcode links used: ${barcodeLinks}, sku-base links used: ${baseLinks})`)

  const outDir = path.join(ROOT, 'data', 'product-review')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'family-classification.csv')
  const header = 'familyId,classification,familySize,sku,name,barcode,price,category'
  const lines = familyRows.map((r) =>
    [r.familyId, r.classification, r.familySize, r.sku, r.name, r.barcode, r.price, r.category]
      .map(csvEscape).join(','),
  )
  fs.writeFileSync(outPath, [header, ...lines].join('\n') + '\n')
  console.log(`\nWrote ${outPath} (${familyRows.length} rows)`)

  // Also write a families-only summary (one line per family, not per member)
  // sorted by size descending, for a faster skim than the full per-row CSV.
  const summaryPath = path.join(outDir, 'family-summary.csv')
  const summaryLines = familyList
    .filter((m) => m.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((members) => {
      const cats = new Set(members.map((s) => categoryById.get(bySku.get(s).category_id) ?? ''))
      return [members.length, members.sort().join('|'), cats.size, [...cats].join('|')]
        .map(csvEscape).join(',')
    })
  fs.writeFileSync(
    summaryPath,
    ['familySize,skus,distinctCategoryCount,categories', ...summaryLines].join('\n') + '\n',
  )
  console.log(`Wrote ${summaryPath} (${summaryLines.length} families)`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
