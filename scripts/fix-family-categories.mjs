// fix-family-categories.mjs
// Run with: node scripts/fix-family-categories.mjs           (dry run, default)
//           node scripts/fix-family-categories.mjs --apply   (actually writes)
//
// For every product family (see classify-product-families.mjs for how
// families are detected: shared barcode or shared SKU-base) that's split
// across more than one category, moves every member to whichever category
// the majority of the family already uses -- e.g. F286388-R (Leis) moves to
// Dome because F286388-Clear/-PK/-PUR/-Blue are already there. Ties (no
// single majority category) are reported but never auto-applied -- those
// need a manual pick.
//
// Dry run only prints the plan. --apply performs the category_id updates
// and logs each change to audit_log (action 'family-category-fix').

import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')

// Barcodes confirmed in docs/BARCODE-CROSS-FAMILY-COLLISIONS.md as two
// UNRELATED products colliding on the same barcode by data-entry error --
// NOT a legitimate "one UPC covers a color family" case. Grouping by barcode
// alone can't tell the two apart, so these are excluded from forming a
// family at all (a shared bad barcode should never justify moving a product
// into another product's category). See that doc for the physical/invoice
// verification these still need -- unrelated to category assignment.
const KNOWN_COLLISION_BARCODES = new Set([
  // DIY Pearl Beads <-> Pull Flower Ribbon
  '737879096840', '737879096857', '737879096864', '737879096871', '737879096888', '737879096895',
  // Rectangular Compact Mirror <-> Ribbon/Decor Clip
  '737879096789', '737879096796', '737879096802', '737879096819', '737879096826', '737879096833',
  // Floral Paper cross-pattern pairs
  '737879073087', '737879073094', '737879073100', '737879098271', '737879098288', '737879098295',
  // Remaining one-off collisions
  '737879084670', '737879075876', '681402394746', '681402394517', '737879077122', '737879089385',
  '737879074497', '737879070185', '737879071311', '737879069677', '737879084656', '737879092903',
  '737879073834', '681402394500', '737879071304', '681402391615', '681402394685', '681402392445',
  '681402393695', '737879094372', '737879098318', '681402400201', '737879073421',
])

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

class UnionFind {
  constructor() { this.parent = new Map() }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x)
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)
    let cur = x
    while (this.parent.get(cur) !== root) { const next = this.parent.get(cur); this.parent.set(cur, root); cur = next }
    return root
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb) }
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE — this will write to Supabase ===' : '=== DRY RUN (pass --apply to write) ===')

  const rows = await selectAll((from, to) =>
    supabase.from('products').select('sku, name, barcode, category_id, is_active').eq('is_active', true).range(from, to),
  )
  const { data: categories } = await supabase.from('categories').select('id, name')
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c.name]))
  const categoryByName = new Map((categories ?? []).map((c) => [c.name, c.id]))

  const uf = new UnionFind()
  for (const r of rows) uf.find(r.sku)

  const byBarcode = new Map()
  for (const r of rows) {
    if (!r.barcode || KNOWN_COLLISION_BARCODES.has(r.barcode)) continue
    if (!byBarcode.has(r.barcode)) byBarcode.set(r.barcode, [])
    byBarcode.get(r.barcode).push(r.sku)
  }
  for (const skus of byBarcode.values()) if (skus.length > 1) for (let i = 1; i < skus.length; i++) uf.union(skus[0], skus[i])

  const byBase = new Map()
  for (const r of rows) {
    const b = baseCode(r.sku).toUpperCase()
    if (!byBase.has(b)) byBase.set(b, [])
    byBase.get(b).push(r.sku)
  }
  for (const skus of byBase.values()) if (skus.length > 1) for (let i = 1; i < skus.length; i++) uf.union(skus[0], skus[i])

  const bySku = new Map(rows.map((r) => [r.sku, r]))
  const families = new Map()
  for (const r of rows) {
    const root = uf.find(r.sku)
    if (!families.has(root)) families.set(root, [])
    families.get(root).push(r.sku)
  }

  const plan = [] // { sku, name, fromCategory, toCategory, toCategoryId }
  const ties = [] // families with no single majority

  for (const members of families.values()) {
    if (members.length < 2) continue
    const counts = new Map() // categoryName -> count
    for (const sku of members) {
      const catName = categoryById.get(bySku.get(sku).category_id) ?? '(none)'
      counts.set(catName, (counts.get(catName) ?? 0) + 1)
    }
    if (counts.size < 2) continue // not split

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const [topCat, topCount] = sorted[0]
    const isTie = sorted.length > 1 && sorted[1][1] === topCount
    if (isTie) {
      ties.push({ members, counts: sorted })
      continue
    }

    const targetCategoryId = categoryByName.get(topCat)
    for (const sku of members) {
      const r = bySku.get(sku)
      const fromCategory = categoryById.get(r.category_id) ?? '(none)'
      if (fromCategory !== topCat) {
        plan.push({ sku, name: r.name, fromCategory, toCategory: topCat, toCategoryId: targetCategoryId })
      }
    }
  }

  console.log(`\n${plan.length} products would move to match their family's majority category.`)
  for (const p of plan) console.log(`  ${p.sku} (${p.name}): ${p.fromCategory} -> ${p.toCategory}`)

  if (ties.length > 0) {
    console.log(`\n${ties.length} families have NO majority category (tie) -- skipped, need a manual pick:`)
    for (const t of ties) {
      console.log(`  ${t.members.join(', ')} -- ${t.counts.map(([c, n]) => `${c}:${n}`).join(' vs ')}`)
    }
  }

  if (!APPLY) {
    console.log('\nDry run only -- no changes made. Re-run with --apply to write these changes.')
    return
  }

  console.log('\nApplying...')
  let applied = 0
  for (const p of plan) {
    const { error } = await supabase.from('products').update({ category_id: p.toCategoryId }).eq('sku', p.sku)
    if (error) {
      console.error(`  FAILED ${p.sku}: ${error.message}`)
      continue
    }
    await supabase.from('audit_log').insert({
      action: 'family-category-fix',
      entity_type: 'product',
      entity_id: p.sku,
      entity_label: p.name,
      old_value: p.fromCategory,
      new_value: p.toCategory,
      performed_by: 'admin',
    })
    applied++
  }
  console.log(`\nApplied ${applied}/${plan.length} category updates.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
