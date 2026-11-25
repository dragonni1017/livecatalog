// compare-lyusa-export.ts
// Run with: npx tsx scripts/compare-lyusa-export.ts "<ALL_products_LYUSA_*.csv>" [--out=data/lyusa-vs-catalog.xlsx]
//
// READ-ONLY. Diffs an LYUSA all-products export (the 84-column ALL21 layout,
// see lib/lyusa.ts) against the live catalog, one tab per kind of difference:
//   Only in LYUSA · Only in catalog · Price · Name · UPC · Status
// Price3 is the WHOLESALE price (50% off the catalog's Retail price, rounded like
// an order: applyTierDiscount) as of the 2026-11-24 export; the Oct 19 one held
// the Retail price. --price3=retail compares against Retail instead. Status
// only flags real disagreements: LYUSA "Active" covers hidden products too.
// Description is
// the catalog name's base followed by LYUSA's own pack/carton wording, so
// names are compared on the base only.
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import XLSX from 'xlsx'

config({ path: path.join(process.cwd(), '.env.local'), quiet: true })
const FILE = process.argv[2]
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'data/lyusa-vs-catalog.xlsx'
if (!FILE || !fs.existsSync(FILE)) {
  console.error('Usage: npx tsx scripts/compare-lyusa-export.ts "<file.csv>" [--out=...]')
  process.exit(1)
}

const norm = (s: string) => s.toLowerCase().replace(/["”“]/g, '"').replace(/\s+/g, ' ').trim()
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '')

;(async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { parseProductName } = await import('../lib/product-naming')
  const { applyTierDiscount } = await import('../lib/order-rules')
  const retail = process.argv.includes('--price3=retail')
  // LYUSA halves to the cent, truncating ($7.25 -> $3.62), not to the storefront's
  // quarters, so accept either.
  const halves = (cents: number) => [Math.floor(cents / 2) / 100, applyTierDiscount(cents, 50) / 100]
  const expectedPrice3 = (cents: number) => (retail ? cents : Math.floor(cents / 2)) / 100
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  const wb = XLSX.read(fs.readFileSync(FILE), { type: 'buffer', raw: true })
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
  const lyusa = new Map(rows.filter((r) => String(r['Item#']).trim()).map((r) => [String(r['Item#']).trim().toUpperCase(), r]))

  type Prod = { sku: string; name: string; price_cents: number; barcode: string | null; is_active: boolean; manually_hidden: boolean | null }
  const catalog = new Map<string, Prod>()
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from('products').select('sku, name, price_cents, barcode, is_active, manually_hidden').order('id').range(f, f + 999)
    if (error) throw error
    for (const p of data as Prod[]) catalog.set(p.sku.toUpperCase(), p)
    if (data!.length < 1000) break
  }

  const onlyLyusa: Record<string, unknown>[] = []
  const onlyCatalog: Record<string, unknown>[] = []
  const price: Record<string, unknown>[] = []
  const name: Record<string, unknown>[] = []
  const upc: Record<string, unknown>[] = []
  const status: Record<string, unknown>[] = []

  for (const [key, r] of lyusa) {
    const p = catalog.get(key)
    const desc = String(r.Description ?? '').trim()
    if (!p) {
      onlyLyusa.push({ SKU: r['Item#'], Status: r.Status, Description: desc, Price3: r.Price3, UPC: r['UPC Code'], 'Create Date': String(r['Create Date']).trim() })
      continue
    }
    const visible = p.is_active && !p.manually_hidden
    const lyPrice = Number(String(r.Price3).replace(/[^0-9.]/g, '')) || 0
    const catPrice = p.price_cents / 100
    const expected = expectedPrice3(p.price_cents)
    const ok = retail ? Math.abs(lyPrice - expected) < 0.005 : halves(p.price_cents).some((h) => Math.abs(lyPrice - h) < 0.005)
    if (!ok) {
      price.push({ SKU: p.sku, Name: p.name, 'LYUSA Price3': lyPrice, [retail ? 'Catalog price' : 'Catalog half (50% off)']: expected, 'Catalog retail': catPrice, Difference: +(lyPrice - expected).toFixed(2), 'Catalog visible': visible ? 'yes' : 'no' })
    }
    const base = norm(parseProductName(p.name).base)
    if (base && !norm(desc).startsWith(base)) {
      name.push({ SKU: p.sku, 'LYUSA Description': desc, 'Catalog name': p.name })
    }
    const a = digits(r['UPC Code'])
    const b = digits(p.barcode)
    if (a !== b && (a || b)) upc.push({ SKU: p.sku, 'LYUSA UPC': r['UPC Code'], 'Catalog barcode': p.barcode ?? '' })
    const lyActive = /^active$/i.test(String(r.Status).trim())
    // Active may be hidden on the website; only Active-vs-inactive or
    // Inactive-vs-visible is a real disagreement.
    if (lyActive ? !p.is_active : visible) {
      status.push({ SKU: p.sku, Name: p.name, 'LYUSA Status': r.Status, 'Catalog': !p.is_active ? 'inactive' : p.manually_hidden ? 'hidden' : 'visible', 'Catalog price': catPrice })
    }
  }
  for (const [key, p] of catalog) {
    if (!lyusa.has(key)) onlyCatalog.push({ SKU: p.sku, Name: p.name, 'Catalog price': p.price_cents / 100, Visible: p.is_active && !p.manually_hidden ? 'yes' : 'no' })
  }

  const out = XLSX.utils.book_new()
  const tabs: [string, Record<string, unknown>[]][] = [
    ['Only in LYUSA', onlyLyusa],
    ['Only in catalog', onlyCatalog],
    ['Price', price],
    ['Name', name],
    ['UPC', upc],
    ['Status', status],
  ]
  for (const [t, r] of tabs) XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(r.length ? r : [{ note: 'no differences' }]), t)
  XLSX.writeFile(out, OUT)

  console.log(`LYUSA file: ${lyusa.size} items · catalog: ${catalog.size} products · in both: ${lyusa.size - onlyLyusa.length}`)
  for (const [t, r] of tabs) console.log(`  ${t}: ${r.length}`)
  const up = price.filter((r) => Number(r.Difference) > 0).length
  console.log(
    `  (price vs ${retail ? 'Retail' : 'Wholesale = 50% off Retail'}: LYUSA higher on ${up}, lower on ${price.length - up}; ` +
      `catalog at $0 on ${price.filter((r) => !r['Catalog retail']).length})`,
  )
  console.log(`Wrote ${OUT}`)
})()
