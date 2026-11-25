// resolve-showroom-codes.ts
// Run with: npx tsx scripts/resolve-showroom-codes.ts "<codes.xlsx>" [--lyusa="<ALL_products_LYUSA_*.csv>"] [--arrivals="<dir>;<dir>"] [--prior="<..._QBD_Check.xlsx>"] [--out=...]
//
// READ-ONLY. Takes a column of codes scanned in the showroom (barcodes, or
// SKUs) and works out, for each: which SKU it is, and where that product
// exists — catalog, Erply, QuickBooks (qb_item_directory). Writes an xlsx with
// one row per code and a "Next step":
//   already in catalog          nothing to do (maybe hidden)
//   in Erply, not catalog       mirror it into the catalog
//   in QuickBooks only          create it (QB product-create pipeline)
//   unresolved                  no system knows this code
//
// A code is tried as a barcode against the LYUSA export's UPC column, the
// catalog's barcode, a prior QBD check sheet (Scanned Code -> QBD Item#) and
// Erply's code2; and as a SKU directly. Barcodes are compared on digits with
// leading zeros dropped, so a 12-digit UPC matches its 13-digit EAN form.
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import XLSX from 'xlsx'

config({ path: path.join(process.cwd(), '.env.local'), quiet: true })
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const FILE = process.argv[2]
const OUT = arg('out') ?? 'data/showroom-resolved.xlsx'
if (!FILE || !fs.existsSync(FILE)) {
  console.error('Usage: npx tsx scripts/resolve-showroom-codes.ts "<codes.xlsx>" [--lyusa=...] [--arrivals=...] [--prior=...] [--out=...]')
  process.exit(1)
}
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '')

;(async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const erply = await import('../lib/erply')
  const { fetchQbItemsBySku } = await import('../lib/qb-item-directory')
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  // Codes: every non-empty cell of the first column that has a digit in it.
  const sheet = XLSX.read(fs.readFileSync(FILE), { type: 'buffer' })
  // raw: true so a barcode stored as a NUMBER keeps every digit, not
  // Excel's display text ("7.37879E+11").
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet.Sheets[sheet.SheetNames[0]], { header: 1, defval: null, raw: true })
  const cellText = (v: unknown) => (typeof v === 'number' ? BigInt(Math.round(v)).toString() : String(v ?? '').trim())
  const codes = [...new Set(raw.map((r) => cellText(r?.[0])).filter((c) => /\d/.test(c)))]
  console.log(`${codes.length} codes in ${path.basename(FILE)}`)

  // LYUSA export: UPC -> Item#, description, Price3.
  const lyusaByUpc = new Map<string, { sku: string; desc: string; price3: string }>()
  const lyusaFile = arg('lyusa')
  if (lyusaFile && fs.existsSync(lyusaFile)) {
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
      XLSX.read(fs.readFileSync(lyusaFile), { type: 'buffer', raw: true }).Sheets['Sheet1'],
      { defval: '', raw: false },
    )
    for (const r of rows) if (digits(r['UPC Code'])) lyusaByUpc.set(digits(r['UPC Code']), { sku: String(r['Item#']).trim(), desc: String(r.Description).trim(), price3: String(r.Price3).trim() })
  }

  // Prior QBD check: Scanned Code -> QBD Item#.
  const priorBy = new Map<string, string>()
  const priorFile = arg('prior')
  if (priorFile && fs.existsSync(priorFile)) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(fs.readFileSync(priorFile), { type: 'buffer' }).Sheets['Showroom Missing Check'], { header: 1, defval: null, raw: false })
    for (const r of rows) if (r?.[0] && r?.[1] && /\d/.test(String(r[0]))) priorBy.set(digits(r[0]), String(r[1]).trim())
  }

  // Arrival Lists: their UPC column (条码) names the SKU for most L&Y
  // barcodes, including ones no system has yet. --arrivals="dir;dir".
  const arrivalBy = new Map<string, string>()
  for (const dir of (arg('arrivals') ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
    if (!fs.existsSync(dir)) continue
    const { bestLinesFromSheets } = await import('../lib/container-check')
    for (const f of fs.readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))) {
      try {
        const book = XLSX.read(fs.readFileSync(path.join(dir, f)), { type: 'buffer' })
        const { lines } = bestLinesFromSheets(book.SheetNames.map((s) => XLSX.utils.sheet_to_json(book.Sheets[s], { header: 1, defval: null, raw: true }) as never))
        for (const l of lines ?? []) {
          const u = digits(l.barcodeFromFile)
          if (u.length >= 8 && !arrivalBy.has(u)) arrivalBy.set(u, l.sku)
        }
      } catch {
        // an unreadable list just contributes nothing
      }
    }
  }
  if (arrivalBy.size) console.log(`${arrivalBy.size} barcodes from Arrival Lists`)

  // Catalog, by SKU and by barcode.
  type Prod = { sku: string; name: string; barcode: string | null; is_active: boolean; manually_hidden: boolean | null; price_cents: number }
  const bySku = new Map<string, Prod>()
  const byBarcode = new Map<string, Prod>()
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from('products').select('sku, name, barcode, is_active, manually_hidden, price_cents').order('id').range(f, f + 999)
    if (error) throw error
    for (const p of data as Prod[]) {
      bySku.set(p.sku.toUpperCase(), p)
      if (digits(p.barcode)) byBarcode.set(digits(p.barcode), p)
    }
    if (data!.length < 1000) break
  }

  const out: Record<string, unknown>[] = []
  for (const code of codes) {
    const d = digits(code)
    let sku: string | null = null
    let via = ''
    const cat = byBarcode.get(d)
    if (cat) [sku, via] = [cat.sku, 'catalog barcode']
    else if (lyusaByUpc.has(d)) [sku, via] = [lyusaByUpc.get(d)!.sku, 'LYUSA UPC']
    else if (arrivalBy.has(d)) [sku, via] = [arrivalBy.get(d)!, 'Arrival List UPC']
    else if (priorBy.has(d)) [sku, via] = [priorBy.get(d)!, 'prior QBD check']
    else if (bySku.has(code.toUpperCase())) [sku, via] = [bySku.get(code.toUpperCase())!.sku, 'is a SKU (catalog)']
    let erplyRec = sku ? await erply.getErplyProductByCode(sku).catch(() => null) : null
    if (!sku && d.length >= 8) {
      const byB = await erply.getErplyProductByBarcode(code).catch(() => null)
      if (byB) [sku, via] = [byB.sku, 'Erply barcode']
    }
    if (!sku) {
      const asCode = await erply.getErplyProductByCode(code).catch(() => null)
      if (asCode) [sku, via, erplyRec] = [code, 'is a SKU (Erply)', asCode]
    }
    if (sku && !erplyRec) erplyRec = await erply.getErplyProductByCode(sku).catch(() => null)
    const qb = sku ? (await fetchQbItemsBySku(db, [sku])).get(sku.toUpperCase())?.[0] ?? null : null
    const inCatalog = sku ? bySku.get(sku.toUpperCase()) ?? null : null
    const ly = lyusaByUpc.get(d)

    // A catalog product found by SKU, not by its barcode, is missing the
    // scanned barcode -- the reason the showroom scanner can't find it.
    const scannedIsBarcode = /^\d{8,14}$/.test(code)
    const barcodeNote = inCatalog && scannedIsBarcode && digits(inCatalog.barcode) !== d
      ? (inCatalog.barcode ? `, barcode differs (${inCatalog.barcode})` : ', no barcode')
      : ''
    const next = !sku
      ? 'unresolved: no system knows this code'
      : inCatalog
        ? `already in catalog${barcodeNote} (${inCatalog.is_active && !inCatalog.manually_hidden ? 'visible' : 'hidden'})`
        : erplyRec
          ? 'in Erply, not catalog: mirror into catalog'
          : qb
            ? 'in QuickBooks only: create in Erply + catalog'
            : 'SKU known (LYUSA / Arrival List) but not in QuickBooks/Erply/catalog'
    out.push({
      Code: code,
      SKU: sku ?? '',
      'Found via': via,
      'Next step': next,
      'Catalog name': inCatalog?.name ?? '',
      'Erply name': erplyRec?.name ?? '',
      'QuickBooks description': qb?.sales_desc?.replace(/\s+/g, ' ').trim() ?? '',
      'QuickBooks price': qb && Number(qb.sales_price) > 0 ? Number(qb.sales_price) : '',
      'LYUSA description': ly?.desc ?? '',
      'LYUSA Price3': ly?.price3 ?? '',
      'Catalog barcode': inCatalog?.barcode ?? '',
    })
  }

  // One tab per outcome as well as the full list, so each group can be
  // worked on its own.
  const groupOf = (r: Record<string, unknown>) => {
    const s = String(r['Next step'])
    if (s.startsWith('already in catalog')) return /no barcode|differs/.test(s) ? 'In catalog, fix barcode' : 'In catalog'
    if (s.startsWith('in Erply')) return 'In Erply only'
    if (s.startsWith('in QuickBooks')) return 'In QuickBooks only'
    if (s.startsWith('SKU known')) return 'SKU known, nowhere else'
    return 'Unknown'
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), 'All codes')
  for (const g of ['In catalog', 'In catalog, fix barcode', 'In Erply only', 'In QuickBooks only', 'SKU known, nowhere else', 'Unknown']) {
    const rows = out.filter((r) => groupOf(r) === g)
    if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), g)
  }
  fs.writeFileSync(OUT, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
  const tally = new Map<string, number>()
  for (const r of out) {
    const k = groupOf(r)
    tally.set(k, (tally.get(k) ?? 0) + 1)
  }
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`)
  console.log(`  (already in catalog but hidden: ${out.filter((r) => String(r['Next step']).endsWith('(hidden)')).length})`)
  console.log(`Wrote ${OUT}`)
})()
