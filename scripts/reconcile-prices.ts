// reconcile-prices.ts
// Run with: node scripts/reconcile-prices.ts
//           node scripts/reconcile-prices.ts --csv
//
// REPORT ONLY. Reads Erply and Supabase, writes nothing.
//
// Closes the loop on the one step no code can do. Erply cannot accept a price
// over its API on this account (proven 2026-09-16, six parameter
// combinations), so every product created from a container is priced by hand
// in the Erply back office. Nothing connected the price someone INTENDED to
// the price Erply ended up holding, which means a typo or a skipped row was
// invisible -- the 95-product backlog found on 2026-09-24 is that gap.
//
// Three numbers per product, and the disagreements between them:
//
//   intended  shipment_lines.proposed_price_cents, typed during receiving
//   erply     the live price, which is the authority
//   catalog   products.price_cents, which mirrors Erply after a sync
//
//   NO INTENT      created without anyone recording a price. Nothing to
//                  check against; it is the state every product created
//                  before 2026-09-24 is in.
//   NOT PRICED     intended, but Erply still holds 0 -- the manual pass has
//                  not reached it. This is the worklist.
//   MISMATCH       Erply disagrees with the intent. A typo, or a decision
//                  changed without updating the line. Worth a human look.
//   STALE CATALOG  Erply and the intent agree but the catalog has not caught
//                  up: the sync has not run since it was priced.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//                         ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const WRITE_CSV = process.argv.includes('--csv')
const CC = process.env.ERPLY_CLIENT_CODE
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
for (const [name, val] of Object.entries({
  ERPLY_CLIENT_CODE: CC,
  ERPLY_USERNAME: process.env.ERPLY_USERNAME,
  ERPLY_PASSWORD: process.env.ERPLY_PASSWORD,
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
})) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const db = createClient(SUPABASE_URL as string, SERVICE_KEY as string)

async function erplyPost(params: Record<string, string>) {
  const res = await fetch(`https://${CC}.erply.com/api/`, {
    method: 'POST',
    body: new URLSearchParams({ clientCode: CC as string, ...params }),
  })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

const sessionKey = (await erplyPost({
  request: 'verifyUser',
  username: process.env.ERPLY_USERNAME as string,
  password: process.env.ERPLY_PASSWORD as string,
})).records[0].sessionKey

// Erply prices, whole catalog
const erplyPrice = new Map<string, number>()
let page = 1, total = Infinity, seen = 0
while (seen < total) {
  const d = await erplyPost({ request: 'getProducts', sessionKey, recordsOnPage: '500', pageNo: String(page) })
  total = d.status.recordsTotal ?? 0
  for (const p of d.records) {
    const code = String(p.code ?? '').trim().toUpperCase()
    if (code) erplyPrice.set(code, Math.round((p.price ?? 0) * 100))
  }
  seen += d.records.length
  if (!d.records.length) break
  page++
}

// Intent, from the lines that created a product
const { data: lines, error } = await db
  .from('shipment_lines')
  .select('sku, proposed_price_cents, erply_created_product_id, shipment_id')
  .not('erply_created_product_id', 'is', null)
if (error) { console.error(error.message); process.exit(1) }

const { data: ships } = await db.from('shipments').select('id, container_ref')
const containerById = new Map((ships ?? []).map((s) => [s.id, s.container_ref as string | null]))

const intent = new Map<string, { cents: number; containers: Set<string> }>()
for (const l of lines ?? []) {
  const sku = String(l.sku).toUpperCase()
  const entry = intent.get(sku) ?? { cents: 0, containers: new Set<string>() }
  if (!entry.cents && (l.proposed_price_cents ?? 0) > 0) entry.cents = l.proposed_price_cents as number
  entry.containers.add(containerById.get(l.shipment_id) ?? '?')
  intent.set(sku, entry)
}

// Catalog prices for the same SKUs
const skus = [...intent.keys()]
const catalogPrice = new Map<string, number>()
const catalogName = new Map<string, string>()
for (let i = 0; i < skus.length; i += 200) {
  const { data } = await db.from('products').select('sku, name, price_cents').in('sku', skus.slice(i, i + 200))
  for (const p of data ?? []) {
    catalogPrice.set(p.sku.toUpperCase(), p.price_cents ?? 0)
    catalogName.set(p.sku.toUpperCase(), p.name)
  }
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`
type Row = { sku: string; state: string; intended: number; erply: number; catalog: number; containers: string }
const rows: Row[] = []
for (const [sku, { cents, containers }] of intent) {
  const e = erplyPrice.get(sku) ?? 0
  const c = catalogPrice.get(sku) ?? 0
  let state: string
  if (!cents) state = 'NO INTENT'
  else if (!e) state = 'NOT PRICED'
  else if (e !== cents) state = 'MISMATCH'
  else if (c !== e) state = 'STALE CATALOG'
  else state = 'ok'
  rows.push({ sku, state, intended: cents, erply: e, catalog: c, containers: [...containers].join(' ') })
}

const by = (state: string) => rows.filter((r) => r.state === state)
console.log(`${rows.length} product(s) created from a container\n`)
for (const state of ['MISMATCH', 'NOT PRICED', 'STALE CATALOG', 'NO INTENT', 'ok']) {
  const list = by(state)
  if (list.length === 0) continue
  console.log(`${state}: ${list.length}`)
  if (state === 'ok' || state === 'NO INTENT') continue
  for (const r of list.slice(0, 25)) {
    console.log(`   ${r.sku.padEnd(16)} intended ${money(r.intended).padStart(9)}  erply ${money(r.erply).padStart(9)}  catalog ${money(r.catalog).padStart(9)}  ${r.containers}`)
  }
  if (list.length > 25) console.log(`   … and ${list.length - 25} more`)
}

if (by('NO INTENT').length === rows.length) {
  console.log('\nNothing to reconcile yet: no product has an intended price recorded.')
  console.log('Type the price during receiving (it is stored on the line) and this')
  console.log('report becomes the check that Erply matches what was decided.')
}

if (WRITE_CSV) {
  const out = path.join(ROOT, 'data', `price-reconciliation-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`)
  const esc = (v: unknown) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  fs.writeFileSync(
    out,
    ['sku,name,state,intended_cents,erply_cents,catalog_cents,containers']
      .concat(rows.map((r) => [r.sku, esc(catalogName.get(r.sku) ?? ''), r.state, r.intended, r.erply, r.catalog, r.containers].join(',')))
      .join('\n') + '\n',
  )
  console.log(`\nCSV: ${path.relative(ROOT, out)}`)
}
