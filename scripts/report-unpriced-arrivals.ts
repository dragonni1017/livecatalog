// report-unpriced-arrivals.ts
// Run with: npx tsx scripts/report-unpriced-arrivals.ts "<folder of Arrival Lists>" [--out=data/unpriced-arrivals.xlsx]
//
// READ-ONLY. Every SKU on the supplier Arrival/Original Lists in a folder that
// has no price yet: in the catalog at $0, or not in the catalog at all (then
// checked in Erply). One row per SKU, with the containers it came on, the
// QuickBooks reference price and its x2.4 Retail suggestion
// (lib/receiving.ts retailCentsFromQb) for whoever sets prices.
//
// Lists are parsed exactly as /admin/receiving does (lib/container-check.ts
// bestLinesFromSheets). When one container has both an Original and an
// Arrival List, the Arrival List wins (pickRecentContainers).
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import XLSX from 'xlsx'

config({ path: path.join(process.cwd(), '.env.local'), quiet: true })
const folder = process.argv[2]
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'data/unpriced-arrivals.xlsx'
if (!folder || !fs.existsSync(folder)) {
  console.error('Usage: npx tsx scripts/report-unpriced-arrivals.ts "<folder>" [--out=...]')
  process.exit(1)
}

;(async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { bestLinesFromSheets, pickRecentContainers } = await import('../lib/container-check')
  const { getErplyProductByCode, isConfigured } = await import('../lib/erply')
  const { fetchQbItemsBySku } = await import('../lib/qb-item-directory')
  const { retailCentsFromQb } = await import('../lib/receiving')
  type SheetRow = import('../lib/packing-list').SheetRow
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  // ── Containers in the folder ───────────────────────────────────────────
  const files = fs.readdirSync(folder).filter((f) => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))
  const picked = pickRecentContainers(files, 1000)
  const unread: string[] = []
  const bySku = new Map<string, { sku: string; pieces: number; perCase: number | null; containers: { ref: string; etd: string }[] }>()
  for (const c of picked) {
    let lines = null
    for (const f of c.files) {
      const wb = XLSX.read(fs.readFileSync(path.join(folder, f)), { type: 'buffer' })
      const sheets = wb.SheetNames.map((s) => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, defval: null }) as SheetRow[])
      lines = bestLinesFromSheets(sheets).lines
      if (lines) break
    }
    if (!lines) {
      unread.push(c.ref)
      continue
    }
    for (const l of lines) {
      const key = l.sku.trim().toUpperCase()
      const e = bySku.get(key) ?? { sku: l.sku.trim(), pieces: 0, perCase: l.piecesPerCase, containers: [] }
      e.pieces += l.qtyShipped
      e.containers.push({ ref: c.ref, etd: c.etd })
      bySku.set(key, e)
    }
  }
  console.log(`${picked.length} containers in the folder (${unread.length} unreadable), ${bySku.size} distinct SKUs`)

  // ── Catalog prices ─────────────────────────────────────────────────────
  type Prod = { sku: string; name: string; price_cents: number; is_active: boolean; manually_hidden: boolean | null }
  const catalog = new Map<string, Prod>()
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from('products').select('sku, name, price_cents, is_active, manually_hidden').order('id').range(f, f + 999)
    if (error) throw error
    for (const p of data as Prod[]) catalog.set(p.sku.toUpperCase(), p)
    if (data!.length < 1000) break
  }

  const unpriced = [...bySku.entries()].filter(([k]) => !((catalog.get(k)?.price_cents ?? 0) > 0))
  const missing = unpriced.filter(([k]) => !catalog.has(k)).map(([, v]) => v.sku)

  // ── Erply, for SKUs the catalog doesn't have ───────────────────────────
  const erplyBySku = new Map<string, { name: string; price: number } | null>()
  if (isConfigured()) {
    let i = 0
    const worker = async () => {
      while (i < missing.length) {
        const sku = missing[i++]
        const e = await getErplyProductByCode(sku).catch(() => null)
        erplyBySku.set(sku.toUpperCase(), e ? { name: e.name, price: e.price } : null)
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
  }

  // ── QuickBooks reference price ─────────────────────────────────────────
  const qb = await fetchQbItemsBySku(db, unpriced.map(([, v]) => v.sku))

  const rows = unpriced
    .map(([key, v]) => {
      const p = catalog.get(key)
      const e = erplyBySku.get(key)
      const q = qb.get(key)?.[0]
      const qbPrice = q && Number(q.sales_price) > 0 ? Number(q.sales_price) : null
      const status = p
        ? `in catalog, ${p.is_active && !p.manually_hidden ? 'visible' : 'hidden'}, $0`
        : e
          ? `in Erply only${e.price > 0 ? ` ($${e.price.toFixed(2)})` : ', $0'}`
          : isConfigured()
            ? 'not in catalog or Erply'
            : 'not in catalog (Erply not checked)'
      const latest = v.containers.map((c) => c.etd).sort().pop() ?? ''
      return {
        SKU: v.sku,
        Name: p?.name ?? e?.name ?? q?.sales_desc?.split('\n')[0] ?? '',
        Status: status,
        'Pieces received': v.pieces,
        'Per case': v.perCase ?? '',
        'QuickBooks price': qbPrice ?? '',
        'Suggested Retail (QB x2.4)': qbPrice ? retailCentsFromQb(qbPrice) / 100 : '',
        'Latest ETD': latest,
        Containers: v.containers.map((c) => c.ref).join(', '),
      }
    })
    .sort((a, b) => String(b['Latest ETD']).localeCompare(String(a['Latest ETD'])) || a.SKU.localeCompare(b.SKU))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Unpriced')
  XLSX.writeFile(wb, OUT)

  const count = (pred: (s: string) => boolean) => rows.filter((r) => pred(r.Status)).length
  console.log(`Wrote ${OUT}: ${rows.length} SKUs without a price`)
  console.log(`  in catalog at $0: ${count((s) => s.startsWith('in catalog'))} (visible: ${count((s) => s.includes('visible'))})`)
  console.log(`  in Erply only: ${count((s) => s.startsWith('in Erply'))}`)
  console.log(`  not in catalog or Erply: ${count((s) => s.startsWith('not in'))}`)
  console.log(`  with a QuickBooks price to start from: ${rows.filter((r) => r['QuickBooks price'] !== '').length}`)
  if (unread.length) console.log(`  unreadable containers: ${unread.join(', ')}`)
})()
