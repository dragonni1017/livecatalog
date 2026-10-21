// check-containers-vs-catalog.ts
// Run with: node scripts/check-containers-vs-catalog.ts
//           node scripts/check-containers-vs-catalog.ts --count=30
//           node scripts/check-containers-vs-catalog.ts --dir="C:/path/to/import documents"
//           node scripts/check-containers-vs-catalog.ts --no-erply
//
// REPORT ONLY. Writes nothing to Supabase, Erply or WooCommerce.
//
// Takes the newest --count containers (default 21) from the OneDrive
// "import documents" folder and checks every SKU on them against the
// catalog: live, hidden, or missing. Each missing SKU is then looked up in
// Erply, which separates the two very different reasons a product can be
// missing:
//   - not in Erply either -> the container was never received (or the SKU
//     never created); a receiving job, not a code problem.
//   - IN Erply but not the catalog -> the nightly sync is failing to insert
//     it. That is a bug; see the products_id_seq collision of 2026-09-23 in
//     docs/memory/project-receiving-to-catalog-20260923.md.
//
// Lines are read with the app's own parser (lib/packing-list.ts), so a file
// that fails here would also fail on /admin/receiving -- those are listed too.
// Per container it prefers the Arrival List, then the Original List; the
// Packing List workbook is an English letterhead format the parser can't read.
//
// First run 2026-10-21: of 335 SKUs on the newest 21 containers, 74 live,
// 131 hidden, 130 missing -- and all 130 were missing from Erply as well.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   and (unless --no-erply) ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
// Writes: data/containers-vs-catalog-<date>.xlsx. Writes nothing else.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import type { PackingListLine, SheetRow } from '../lib/packing-list.ts'
import { bestLinesFromSheets, pickRecentContainers, type PickedContainer } from '../lib/container-check.ts'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XLSX: any = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const COUNT = Number(arg('count') ?? 21)
const DIR = arg('dir') ?? 'C:/Users/Dragon/OneDrive - L&Y USA/L&Y/L&Y/import documents'
const CHECK_ERPLY = !process.argv.includes('--no-erply')
const stamp = new Date().toISOString().slice(0, 10)
const OUT = path.join(ROOT, 'data', `containers-vs-catalog-${stamp}.xlsx`)

const env = (k: string) => {
  const v = process.env[k]
  if (!v) { console.error(`Missing in .env.local: ${k}`); process.exit(1) }
  return v
}
if (!Number.isInteger(COUNT) || COUNT < 1) { console.error('--count must be a positive whole number'); process.exit(1) }
if (!fs.existsSync(DIR)) { console.error(`No such folder: ${DIR} (pass --dir=)`); process.exit(1) }

// ── Pick and parse the containers ──────────────────────────────────────────
// Shared with the /admin/receiving container check (lib/container-check.ts):
// newest first by year-month + ETD; per container the Arrival List, then the
// Original List, and within a workbook the tab that parses to the most lines.
const allNames = fs.readdirSync(DIR)
const recent = pickRecentContainers(allNames, COUNT)
console.log(`${allNames.length} files in ${DIR}; checking the newest ${recent.length} containers`)

interface Parsed { c: PickedContainer; file: string | null; lines: PackingListLine[]; error: string | null }
const parsed: Parsed[] = []
for (const c of recent) {
  let result: Parsed = { c, file: null, lines: [], error: 'no Arrival or Original List' }
  for (const name of c.files) {
    const wb = XLSX.readFile(path.join(DIR, name))
    const sheets: SheetRow[][] = wb.SheetNames.map((s: string) => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, defval: null }))
    const { lines, error } = bestLinesFromSheets(sheets)
    result = { c, file: name, lines: lines ?? [], error }
    if (lines) break
  }
  parsed.push(result)
}

// ── Catalog ─────────────────────────────────────────────────────────────────
const db = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
})
interface CatalogRow {
  sku: string | null
  name: string
  is_active: boolean
  manually_hidden: boolean | null
  price_cents: number | null
  stock_qty: number | null
  image_url: string | null
  category_id: string | null
}
const catalog = new Map<string, CatalogRow>()
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('products')
    .select('sku, name, is_active, manually_hidden, price_cents, stock_qty, image_url, category_id')
    .order('id')
    .range(from, from + 999)
  if (error) throw new Error(`Supabase: ${error.message}`)
  for (const p of data as CatalogRow[]) if (p.sku) catalog.set(p.sku.trim().toUpperCase(), p)
  if (data.length < 1000) break
}

const statusOf = (p: CatalogRow | undefined) => (!p ? 'not in catalog' : p.is_active && !p.manually_hidden ? 'live' : 'hidden')

// ── Erply, for the missing ones only ────────────────────────────────────────
const missingSkus = new Map<string, string>()
for (const r of parsed) for (const l of r.lines) {
  const key = l.sku.trim().toUpperCase()
  if (!catalog.has(key)) missingSkus.set(key, l.sku.trim())
}
const inErply = new Map<string, { id: number; status: string }>()
if (CHECK_ERPLY && missingSkus.size) {
  const api = `https://${env('ERPLY_CLIENT_CODE')}.erply.com/api/`
  let sessionKey = ''
  const erply = async (params: Record<string, string>) => {
    if (!sessionKey) {
      const body = new URLSearchParams({ clientCode: env('ERPLY_CLIENT_CODE'), request: 'verifyUser', username: env('ERPLY_USERNAME'), password: env('ERPLY_PASSWORD') })
      sessionKey = (await (await fetch(api, { method: 'POST', body })).json()).records[0].sessionKey
    }
    const json = await (await fetch(api, { method: 'POST', body: new URLSearchParams({ clientCode: env('ERPLY_CLIENT_CODE'), sessionKey, ...params }) })).json()
    if (json.status?.responseStatus !== 'ok') throw new Error(`Erply ${params.request}: ${JSON.stringify(json.status)}`)
    return json
  }
  console.log(`Looking up ${missingSkus.size} missing SKUs in Erply...`)
  for (const [key, sku] of missingSkus) {
    // getProducts' code filter is case-insensitive; the exact-code check
    // below stops a prefix or partial match from counting.
    const json = await erply({ request: 'getProducts', code: sku })
    const rec = json.records?.find((r: { code?: string }) => (r.code ?? '').trim().toUpperCase() === key)
    if (rec) inErply.set(key, { id: rec.productID, status: rec.status })
  }
}
const erplyOf = (key: string) => (!CHECK_ERPLY ? 'not checked' : inErply.has(key) ? `YES #${inErply.get(key)!.id} (sync gap)` : 'no')

// ── Rows ────────────────────────────────────────────────────────────────────
const containersBySku = new Map<string, Set<string>>()
for (const r of parsed) for (const l of r.lines) {
  const key = l.sku.trim().toUpperCase()
  ;(containersBySku.get(key) ?? containersBySku.set(key, new Set()).get(key)!).add(r.c.ref)
}

const lineRows = parsed.flatMap((r) =>
  r.lines.map((l) => {
    const key = l.sku.trim().toUpperCase()
    const p = catalog.get(key)
    return {
      Container: r.c.ref,
      ETD: r.c.etd,
      SKU: l.sku.trim(),
      Pieces: l.qtyShipped,
      Status: statusOf(p),
      'In Erply': p ? '' : erplyOf(key),
      Name: p?.name ?? '',
      Price: p?.price_cents != null ? p.price_cents / 100 : '',
      Stock: p?.stock_qty ?? '',
      Photo: p ? (p.image_url ? 'yes' : 'no') : '',
      Category: p ? (p.category_id ? 'yes' : 'no') : '',
      'Also on': [...containersBySku.get(key)!].filter((x) => x !== r.c.ref).join(', '),
    }
  }),
)

const summaryRows = parsed.map((r) => {
  const rows = lineRows.filter((x) => x.Container === r.c.ref)
  const n = (s: string) => rows.filter((x) => x.Status === s).length
  return {
    Container: r.c.ref,
    ETD: r.c.etd,
    SKUs: rows.length,
    Live: n('live'),
    Hidden: n('hidden'),
    'Not in catalog': n('not in catalog'),
    'In Erply, not catalog': rows.filter((x) => x['In Erply'].startsWith('YES')).length,
    'On other containers too': rows.filter((x) => x['Also on']).length,
    File: r.file ?? '',
    'Parse error': r.error ?? '',
  }
})

// ── Write ───────────────────────────────────────────────────────────────────
const sheet = (rows: object[], widths: number[]) => {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Container: '(none)' }])
  ws['!cols'] = widths.map((wch) => ({ wch }))
  if (rows.length) ws['!autofilter'] = { ref: ws['!ref'] }
  return ws
}
const lineWidths = [13, 12, 15, 8, 14, 22, 50, 7, 7, 6, 8, 30]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, sheet(summaryRows, [13, 12, 6, 6, 7, 13, 19, 21, 60, 50]), 'By Container')
XLSX.utils.book_append_sheet(wb, sheet(lineRows.filter((x) => x.Status === 'not in catalog'), lineWidths), 'Not in Catalog')
XLSX.utils.book_append_sheet(wb, sheet(lineRows.filter((x) => x.Status === 'hidden'), lineWidths), 'Hidden')
XLSX.utils.book_append_sheet(wb, sheet(lineRows.filter((x) => x['Also on']), lineWidths), 'On 2+ Containers')
XLSX.utils.book_append_sheet(wb, sheet(lineRows, lineWidths), 'All Lines')
fs.mkdirSync(path.dirname(OUT), { recursive: true })
XLSX.writeFile(wb, OUT)

// ── Console summary ─────────────────────────────────────────────────────────
console.log('')
console.table(summaryRows.map((r) => {
  const { 'Parse error': err, ...shown } = r
  delete (shown as Partial<typeof shown>).File
  return err ? { ...shown, 'Parse error': err.slice(0, 40) } : shown
}))
const distinct = new Map(lineRows.map((x) => [x.SKU.toUpperCase(), x]))
const count = (s: string) => [...distinct.values()].filter((x) => x.Status === s).length
console.log(`${distinct.size} distinct SKUs: ${count('live')} live, ${count('hidden')} hidden, ${count('not in catalog')} not in catalog`)
if (CHECK_ERPLY) {
  const gap = [...inErply.keys()]
  console.log(gap.length
    ? `!! ${gap.length} SKU(s) are in Erply but NOT in the catalog -- the sync is missing them: ${gap.join(' ')}`
    : `All ${missingSkus.size} missing SKUs are missing from Erply too: not received yet, no sync problem.`)
}
const unparsed = parsed.filter((r) => r.error)
if (unparsed.length) console.log(`${unparsed.length} container(s) could not be parsed (would fail on /admin/receiving too): ${unparsed.map((r) => r.c.ref).join(', ')}`)
console.log(`\nWrote ${path.relative(ROOT, OUT)}`)
