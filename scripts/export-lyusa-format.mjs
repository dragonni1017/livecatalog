// export-lyusa-format.mjs
// Run with:
//   node scripts/export-lyusa-format.mjs <template.csv> <out.csv>
//
// Read-only. Exports every catalog-visible product (is_active and not
// manually_hidden) as a CSV in the same 87-column LYUSA item-import layout as
// <template.csv> (e.g. ALL21_products_LYUSA_template_v2.csv).
//
// Columns that the template holds constant (WHS#, Lot#, the zero / "  /  /"
// placeholders...) are copied from its first row. Per product:
//   Item#, Description, Unit, Price3 (live catalog price), Create Date (today),
//   Class# / Dept#, Image Name (Z:\Pic\<SKU>.jpg), Unit/Case, Default Unit,
//   UPC Code, Case Wt.
// Description follows the template's two styles, built from the name's pack
// spec "<pk>/pk <bx>bx/cs cs.<N>" (docs/PRODUCT-NAMING-STANDARD.md):
//   single unit per case side:  "<Name> - 20/cs - 29" x 22" x 16" - 33lbs - cs.20"  (Default Unit PC)
//   packs of several pieces:    "<Name> - 12/pk - 20pk/cs - case dim. 31" x 18" x 16" - 26lbs"  (Default Unit CS)
// Class#/Dept# come from the template for SKUs already in it, otherwise from
// CATEGORY_CODES below by primary category. A SKU in the template also fills
// case dims/weight/UPC the database is missing.
//
// Also writes <out>-needs-code.csv listing products left without a Class#.
// Writes nothing to Supabase.

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

const [templatePath, outPath] = process.argv.slice(2)
if (!templatePath || !outPath) {
  console.error('Usage: node scripts/export-lyusa-format.mjs <template.csv> <out.csv>')
  process.exit(1)
}

// Catalog category -> [Dept#, Class#]. Codes are the ones the template uses.
const CATEGORY_CODES = {
  'Papers': ['FLORAL SUP', 'PAPER'],
  'Mesh Paper': ['FLORAL SUP', 'PAPER'],
  'Floral Supplies': ['FLORAL SUP', 'FLSUP'],
  'Leis': ['FLORAL SUP', 'FLSUP'],
  'Dome': ['FLORAL SUP', 'FLSUP'],
  'Floral Boxes': ['FLORAL SUP', 'FLBOX'],
  'Floral Basket': ['FLORAL SUP', 'BASKT'],
  'Flowers': ['FLORAL SUP', 'FLOWR'],
  'Flower Spray': ['FLORAL SUP', 'FLOWR'],
  'Ribbons': ['FLORAL SUP', 'RIBBN'],
  'Bows': ['FLORAL SUP', 'RIBBN'],
  'Crowns': ['FLORAL SUP', 'CROWN'],
  'Gift Bags': ['FLORAL SUP', 'GIFTB'],
  'Plush': ['TOYS', 'PLUSH'],
  'Toys & Novelties': ['TOYS', 'NOVEL'],
  '3D Printed': ['TOYS', 'NOVEL'],
  'Keychains': ['GEN MERCH', 'KEYCH'],
  'Stationery & Office': ['GEN MERCH', 'STATI'],
  'Drinkware & Cups': ['GEN MERCH', 'DRINK'],
  'Plate Set': ['GEN MERCH', 'DRINK'],
  'Beauty & Personal Care': ['GEN MERCH', 'BEAUT'],
  'Fan': ['GEN MERCH', 'FAN'],
  'Lamps': ['GEN MERCH', 'LAMP'],
  'Humidifier': ['GEN MERCH', 'LAMP'],
  'Crochet': ['GEN MERCH', 'CROCH'],
  'Bags/Purses': ['GEN MERCH', 'BAGS'],
  'LED': ['GEN MERCH', 'LED'],
  'Candy': ['GEN MERCH', 'CANDY'],
  'Accessories & Apparel': ['GEN MERCH', 'ACCES'],
  'Umbrella': ['GEN MERCH', 'ACCES'],
  'Speakers': ['GEN MERCH', 'ACCES'],
  'Picture Frames': ['GEN MERCH', 'ACCES'],
  'Candles': ['GEN MERCH', 'ACCES'],
  'Blankets': ['GEN MERCH', 'ACCES'],
  'Seasonal & Holiday': ['SEASONAL', 'SEASO'],
  'Deco': ['SEASONAL', 'SEASO'],
}

// Same pattern as public.product_pack_match (migration 0054).
const PACK_RE = /\s*-\s*(\d+)\s*\/pk\s+(\d+)\s*bx\/cs(?:\s+cs\.(\d+)\s*(pk|bx|set|pcs|pc)?)?\s*$/i
// Template description dims/weight, e.g. 29" x 22" x 16" - 33lbs
const TPL_DIMS_RE = /([\d.]+)"\s*x\s*([\d.]+)"\s*x\s*([\d.]+)"/
const TPL_WT_RE = /([\d.]+)\s*lbs/i

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function fetchVisibleProducts() {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('sku, name, barcode, price_cents, category_id, case_pieces, sold_by, case_length_in, case_width_in, case_height_in, case_weight_lb')
      .eq('is_active', true)
      .eq('manually_hidden', false)
      .range(from, from + 999)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < 1000) break
  }
  return all
}

const num = (v) => String(Number(Number(v).toFixed(2)))
const unitCode = (n) => (n < 100 ? `CS${n}` : `C${n}`)
const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

function buildRow(p, tpl, codes, today) {
  const m = p.name.match(PACK_RE)
  const base = m ? p.name.slice(0, m.index).trim() : p.name.trim()
  const pk = m ? Number(m[1]) : null
  const bx = m ? Number(m[2]) : null
  const pieces = p.case_pieces ?? (m ? pk * bx : null)

  let dims = p.case_length_in ? [p.case_length_in, p.case_width_in, p.case_height_in] : null
  let wt = p.case_weight_lb
  if (tpl) {
    const td = tpl.Description.match(TPL_DIMS_RE)
    const tw = tpl.Description.match(TPL_WT_RE)
    if (!dims && td) dims = [td[1], td[2], td[3]]
    if (!wt && tw) wt = tw[1]
  }
  const dimStr = dims ? `${num(dims[0])}" x ${num(dims[1])}" x ${num(dims[2])}"` : ''
  const wtStr = wt ? `${num(wt)}lbs` : ''

  // Several pieces per pack AND several packs per case: the "pk/pk - bxpk/cs"
  // style, sold by the case. Otherwise one figure per case, sold by the piece.
  const multiPack = m && (pk > 1 && bx > 1 || p.sold_by === 'pack')
  let description
  if (!m) {
    description = [base, dimStr, wtStr].filter(Boolean).join(' - ')
  } else if (multiPack) {
    description = [base, `${pk}/pk`, `${bx}pk/cs`, dimStr && `case dim. ${dimStr}`, wtStr].filter(Boolean).join(' - ')
  } else {
    description = [base, `${pieces}/cs`, dimStr, wtStr, `cs.${pieces}`].filter(Boolean).join(' - ')
  }

  // No pack spec in the name, but the template has this SKU: keep its
  // description and case units rather than dropping them.
  const useTpl = !m && tpl && tpl.Unit
  return {
    'Item#': p.sku,
    Description: useTpl ? tpl.Description : description,
    Unit: useTpl ? tpl.Unit : pieces ? unitCode(pieces) : '',
    Price3: num(p.price_cents / 100),
    'Create Date': ` ${today}`,
    'Dept#': codes ? codes[0] : '',
    'Class#': codes ? codes[1] : '',
    'Image Name': `Z:\\Pic\\${p.sku}.jpg`,
    'Unit/Case': useTpl ? tpl['Unit/Case'] : pieces ?? '',
    'Default Unit': useTpl ? tpl['Default Unit'] : multiPack ? 'CS' : 'PC',
    'UPC Code': p.barcode || tpl?.['UPC Code'] || '',
    'Case Wt': wt ? num(wt) : '0',
  }
}

async function main() {
  const tplWb = XLSX.readFile(templatePath, { raw: true })
  const tplRows = XLSX.utils.sheet_to_json(tplWb.Sheets[tplWb.SheetNames[0]], { raw: false, defval: '' })
  const header = Object.keys(tplRows[0])
  const filler = tplRows[0]
  const tplBySku = new Map(tplRows.map((r) => [r['Item#'].trim().toUpperCase(), r]))

  const { data: cats, error } = await supabase.from('categories').select('id, name')
  if (error) { console.error('Supabase category read error:', error.message); process.exit(1) }
  const catName = new Map(cats.map((c) => [c.id, c.name]))

  const products = await fetchVisibleProducts()
  console.log(`${products.length} visible products`)

  const d = new Date()
  const today = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`

  const lines = [header.map(quote).join(',')]
  const needsCode = []
  const stats = { fromTemplate: 0, noPack: 0, noWeight: 0 }
  for (const p of products.sort((a, b) => a.sku.localeCompare(b.sku))) {
    const tpl = tplBySku.get(p.sku.trim().toUpperCase())
    const category = catName.get(p.category_id) ?? ''
    const codes = tpl && tpl['Class#'] ? [tpl['Dept#'], tpl['Class#']] : CATEGORY_CODES[category]
    if (tpl) stats.fromTemplate++
    if (!codes) needsCode.push([p.sku, p.name, category])

    const row = buildRow(p, tpl, codes, today)
    if (!row.Unit) stats.noPack++
    if (row['Case Wt'] === '0') stats.noWeight++
    lines.push(header.map((h) => quote(h in row ? row[h] : filler[h])).join(','))
  }

  // Match the template: UTF-8 with BOM, CRLF, every field quoted.
  fs.writeFileSync(outPath, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8')
  console.log(`Wrote ${lines.length - 1} rows -> ${outPath}`)
  console.log(`  ${stats.fromTemplate} matched a template row (its Class#/Dept# used)`)
  console.log(`  ${stats.noPack} with no pack spec (Unit and Unit/Case blank)`)
  console.log(`  ${stats.noWeight} with no case weight (Case Wt 0)`)

  const needsPath = outPath.replace(/\.csv$/i, '') + '-needs-code.csv'
  fs.writeFileSync(needsPath, '\uFEFF' + [['SKU', 'Name', 'Category'], ...needsCode].map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n', 'utf8')
  console.log(`  ${needsCode.length} without a Class#/Dept# -> ${needsPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
