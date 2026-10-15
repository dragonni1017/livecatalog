// fill-case-weights-from-arrival-lists.mjs
// Run with: node scripts/fill-case-weights-from-arrival-lists.mjs --dir="<folder>"          (dry run)
//           node scripts/fill-case-weights-from-arrival-lists.mjs --dir="<folder>" --apply
//
// Fills products.case_weight_lb ONLY WHERE IT IS EMPTY, from every supplier
// container "Arrival List" / "Original List" xls/xlsx in <folder> (same
// supplier format as import-packing-list.mjs: a 货号 SKU column -- or "item"
// on some 2026-09 files -- a UPC column, and 毛重KG（每包装箱）, gross kg per
// carton). Existing weights and all dimensions are left alone; to replace
// carton figures wholesale use import-packing-list.mjs on one file instead.
//
// Rules, mirroring import-packing-list.mjs:
//   - weight unit is read from the header (kg or lb), never assumed
//   - the sheet's UPC must match products.barcode when both exist, else the
//     row is skipped (barcode-collision history, see docs/memory)
//   - a SKU whose files disagree by more than 10% is skipped and reported
//   - weight over 250 lb, or denser than lead against the product's stored
//     dims, is skipped (lib/measurements.ts bounds)
// "- Copy" duplicates of a file are ignored.
//
// Writes per row with update().eq('id') (an id-only upsert fails NOT NULL on
// sku -- see docs/memory/project-product-measurements.md, point 9).
// measurements_source is NOT stamped: topping up a row doesn't claim it
// (same point 8). Provenance goes in measurements_updated_by.
// Writes to Supabase only.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')
const dirArg = process.argv.find((a) => a.startsWith('--dir='))?.slice('--dir='.length)
if (!dirArg || !fs.existsSync(dirArg)) {
  console.error('Usage: node scripts/fill-case-weights-from-arrival-lists.mjs --dir="<folder with arrival lists>" [--apply]')
  process.exit(1)
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const MAX_WEIGHT_LB = 250
const LEAD_LB_PER_IN3 = 0.41
const KG_TO_LB = 2.20462262

const cellHas = (c, subs) => typeof c === 'string' && subs.every((s) => c.includes(s))
const isSkuHeader = (c) => cellHas(c, ['货号']) || (typeof c === 'string' && c.trim().toLowerCase() === 'item')
const normUpc = (v) => String(v ?? '').replace(/\D/g, '')
const round2 = (n) => Math.round(n * 100) / 100

function weightFactor(header) {
  const h = header.toLowerCase()
  if (h.includes('kg')) return KG_TO_LB
  if (h.includes('lb')) return 1
  return null
}

// SKU -> [{ file, upc, lb }]
function readFiles(dir) {
  const files = fs.readdirSync(dir)
    .filter((f) => /(arrival|original) list.*\.xlsx?$/i.test(f) && !/ - copy/i.test(f))
  const bySku = new Map()
  const perFile = []
  for (const f of files) {
    const wb = XLSX.readFile(path.join(dir, f), { cellStyles: false })
    let rows = 0
    const notes = []
    for (const sn of wb.SheetNames) {
      const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' })
      const hi = data.slice(0, 10).findIndex((r) => r.some(isSkuHeader))
      if (hi < 0) continue
      const h = data[hi]
      const skuCol = h.findIndex(isSkuHeader)
      const upcCol = h.findIndex((c) => cellHas(c, ['UPC']))
      const wtCol = h.findIndex((c) => cellHas(c, ['毛重']))
      if (wtCol < 0) continue // e.g. a count-only sheet
      const factor = weightFactor(h[wtCol])
      if (!factor) { notes.push(`${sn}: can't tell weight unit of "${h[wtCol]}"`); continue }
      for (const r of data.slice(hi + 1)) {
        const sku = String(r[skuCol] ?? '').trim().toUpperCase()
        const w = Number(r[wtCol])
        if (!sku || !(w > 0)) continue
        if (!bySku.has(sku)) bySku.set(sku, [])
        bySku.get(sku).push({ file: f, upc: upcCol >= 0 ? normUpc(r[upcCol]) : '', lb: round2(w * factor) })
        rows++
      }
    }
    perFile.push({ file: f.slice(0, 32), rows, notes: notes.join('; ') })
  }
  return { files, bySku, perFile }
}

async function fetchProducts() {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, name, barcode, is_active, manually_hidden, case_weight_lb, case_length_in, case_width_in, case_height_in')
      .range(from, from + 999)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < 1000) break
  }
  return all
}

async function main() {
  const { files, bySku, perFile } = readFiles(dirArg)
  console.log(`${files.length} arrival list files, ${bySku.size} SKUs with a carton weight`)
  console.table(perFile)

  const products = await fetchProducts()
  const missing = products.filter((p) => p.is_active && !p.case_weight_lb)

  const updates = []
  const skipped = []
  for (const p of missing) {
    const recs = bySku.get(p.sku.trim().toUpperCase())
    if (!recs) continue
    const ok = recs.filter((r) => !r.upc || !p.barcode || r.upc === normUpc(p.barcode))
    if (!ok.length) { skipped.push([p.sku, 'UPC does not match the database barcode', recs.map((r) => r.upc).join('/')]); continue }
    const lbs = ok.map((r) => r.lb)
    if (Math.max(...lbs) / Math.min(...lbs) > 1.1) { skipped.push([p.sku, 'files disagree', [...new Set(lbs)].join(' / ') + ' lb']); continue }
    const lb = ok[0].lb
    if (lb > MAX_WEIGHT_LB) { skipped.push([p.sku, `over ${MAX_WEIGHT_LB} lb`, lb]); continue }
    const dims = [p.case_length_in, p.case_width_in, p.case_height_in]
    if (dims.every((d) => d > 0) && lb / (dims[0] * dims[1] * dims[2]) > LEAD_LB_PER_IN3) {
      skipped.push([p.sku, 'denser than lead against stored dims', lb]); continue
    }
    updates.push({ id: p.id, sku: p.sku, name: p.name, visible: !p.manually_hidden, lb, file: ok[0].file })
  }

  console.log(`\n${missing.length} active products have no case weight (${missing.filter((p) => !p.manually_hidden).length} visible)`)
  console.log(`${updates.length} can be filled from the arrival lists (${updates.filter((u) => u.visible).length} visible)`)
  if (skipped.length) { console.log(`${skipped.length} skipped:`); console.table(skipped.map(([sku, why, v]) => ({ sku, why, value: v }))) }
  console.log('\nSample:')
  console.table(updates.slice(0, 8).map((u) => ({ sku: u.sku, lb: u.lb, name: u.name.slice(0, 40) })))

  if (!APPLY) { console.log('\nDry run -- nothing written. Re-run with --apply to write.'); return }

  let ok = 0
  const failed = []
  for (let i = 0; i < updates.length; i += 8) {
    await Promise.all(updates.slice(i, i + 8).map(async (u) => {
      const { error } = await supabase
        .from('products')
        .update({
          case_weight_lb: u.lb,
          measurements_updated_by: `packing-list:${u.file}`,
          measurements_updated_at: new Date().toISOString(),
        })
        .eq('id', u.id)
        .is('case_weight_lb', null) // never overwrite a weight set in the meantime
      if (error) failed.push([u.sku, error.message]); else ok++
    }))
  }
  console.log(`\nWrote ${ok} weights, ${failed.length} failed`)
  if (failed.length) console.table(failed)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
