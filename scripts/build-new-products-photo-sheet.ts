// build-new-products-photo-sheet.ts
// Run with: node scripts/build-new-products-photo-sheet.ts
//
// REPORT ONLY. Writes one xlsx to data/ and touches nothing else.
//
// Every product /admin/receiving created in Erply, split into the ones that
// have a photo and the ones that still need shooting. Built after the
// 2026-09-23 containers, where 52 of 75 new SKUs came out with a photo.
//
// The "Photo" column is an Excel =IMAGE() formula pointing at a w_300
// Cloudinary thumbnail, so the picture renders in the cell rather than
// being a link you have to click. IMAGE() needs Excel 365 / Excel for the
// web -- older Excel and LibreOffice show #NAME?, which is why the full URL
// is also there as its own column. The thumbnail is deliberately not the
// original: a sheet of 52 full-size originals is ~100 MB of fetching.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolveCdnImage } from '../lib/image.ts'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const THUMB_WIDTH = 300

interface Line {
  sku: string
  qty_received: number
  erply_created_product_id: number | null
  shipment_id: string
  proposed_category: string | null
}

const { data: shipments } = await db.from('shipments').select('id, file_name')
const containerByShipment = new Map(
  (shipments ?? []).map((s) => [s.id, (s.file_name.match(/Cntr#(\w+)/) ?? [, ''])[1] || s.file_name.slice(0, 30)]),
)

const lines: Line[] = []
for (let from = 0; ; from += 1000) {
  const { data } = await db
    .from('shipment_lines')
    .select('sku, qty_received, erply_created_product_id, shipment_id, proposed_category')
    .not('erply_created_product_id', 'is', null)
    .range(from, from + 999)
  lines.push(...((data ?? []) as Line[]))
  if ((data ?? []).length < 1000) break
}

// A SKU can appear on two containers (K229582 did) -- keep every container it
// arrived on, and sum what was received.
const bySku = new Map<string, { containers: Set<string>; qty: number; category: string | null }>()
for (const l of lines) {
  const key = l.sku.toUpperCase()
  const entry = bySku.get(key) ?? { containers: new Set<string>(), qty: 0, category: l.proposed_category }
  entry.containers.add(containerByShipment.get(l.shipment_id) ?? '?')
  entry.qty += l.qty_received ?? 0
  bySku.set(key, entry)
}

const { data: products } = await db
  .from('products')
  .select('sku, name, price_cents, stock_qty, image_url, image_urls, manually_hidden, category:categories!products_category_id_fkey(name)')
  .in('sku', [...new Set(lines.map((l) => l.sku))])

type Row = Record<string, unknown>
const withPhoto: Row[] = []
const noPhoto: Row[] = []

const sorted = (products ?? []).sort((a, b) => a.sku.localeCompare(b.sku))
for (const p of sorted) {
  const meta = bySku.get(p.sku.toUpperCase())
  const category = (p.category as { name?: string } | null)?.name ?? '(none)'
  const base: Row = {
    SKU: p.sku,
    'Product name': p.name,
    Category: category,
    Container: [...(meta?.containers ?? [])].join(', '),
    'Pieces received': meta?.qty ?? 0,
    'Stock in catalog': p.stock_qty ?? 0,
    Price: (p.price_cents ?? 0) === 0 ? 'NOT PRICED' : `$${((p.price_cents ?? 0) / 100).toFixed(2)}`,
    'Live on site': p.manually_hidden ? 'No - hidden until priced' : 'Yes',
  }

  if (p.image_url) {
    const thumb = resolveCdnImage(p.image_url, THUMB_WIDTH) ?? p.image_url
    withPhoto.push({
      Photo: '',                       // replaced with an =IMAGE() formula below
      ...base,
      Views: Array.isArray(p.image_urls) ? p.image_urls.length : 1,
      'Photo URL': p.image_url,
      _thumb: thumb,
    })
  } else {
    noPhoto.push({ ...base, 'Photo needed': 'YES - no file locally, none in Erply' })
  }
}

const wb = XLSX.utils.book_new()

// --- Sheet 1: the ones with a photo ---
const sheet1Rows = withPhoto.map(({ _thumb, ...rest }) => rest)   // eslint-disable-line @typescript-eslint/no-unused-vars
const ws = XLSX.utils.json_to_sheet(sheet1Rows)

// Swap the empty Photo cell for an =IMAGE() formula. Column A, data starts at
// row 2. Writing { t:'s', f } keeps a string fallback if formulas are stripped.
withPhoto.forEach((row, i) => {
  const addr = XLSX.utils.encode_cell({ c: 0, r: i + 1 })
  ws[addr] = { t: 's', v: '', f: `IMAGE("${row._thumb}")` }
})

ws['!cols'] = [
  { wpx: 120 },  // Photo
  { wpx: 110 },  // SKU
  { wpx: 330 },  // Product name
  { wpx: 130 },  // Category
  { wpx: 110 },  // Container
  { wpx: 90 },   // Pieces received
  { wpx: 90 },   // Stock in catalog
  { wpx: 80 },   // Price
  { wpx: 150 },  // Live on site
  { wpx: 50 },   // Views
  { wpx: 420 },  // Photo URL
]
// Tall enough for the image to be worth looking at.
ws['!rows'] = [{ hpx: 20 }, ...withPhoto.map(() => ({ hpx: 95 }))]
ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 10, r: withPhoto.length } }) }
XLSX.utils.book_append_sheet(wb, ws, `With photo (${withPhoto.length})`)

// --- Sheet 2: the shoot list ---
const ws2 = XLSX.utils.json_to_sheet(noPhoto)
ws2['!cols'] = [
  { wpx: 130 }, { wpx: 330 }, { wpx: 130 }, { wpx: 110 },
  { wpx: 90 }, { wpx: 90 }, { wpx: 80 }, { wpx: 150 }, { wpx: 240 },
]
XLSX.utils.book_append_sheet(wb, ws2, `Needs a photo (${noPhoto.length})`)

const out = path.join(ROOT, 'data', `new-products-photos-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`)
XLSX.writeFile(wb, out)

console.log(`${withPhoto.length} with a photo, ${noPhoto.length} without`)
console.log(`Written: ${path.relative(ROOT, out)}`)
console.log(`\nThe Photo column uses Excel's =IMAGE() -- it renders in Excel 365 / Excel for the web.`)
console.log(`Anywhere else it shows #NAME?; the "Photo URL" column is the fallback.`)
