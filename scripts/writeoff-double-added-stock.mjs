// writeoff-double-added-stock.mjs
// Run with: node scripts/writeoff-double-added-stock.mjs                 (dry run)
//           node scripts/writeoff-double-added-stock.mjs --apply
//           node scripts/writeoff-double-added-stock.mjs --old=44,45 --new=51
//
// Removes stock that was added to Erply twice for the same shipment.
//
// The incident this was written for (2026-09-23): container EGSU9509206's
// August arrival list was stocked on 2026-09-03 by
// scripts/add-stock-from-arrival-lists.mjs (Erply registration docs 44+45),
// and then received AGAIN through /admin/receiving at 19:16 the same day
// (doc 51). Nothing caught it: the receiving screen's file_hash guard only
// knows about shipments staged through the app, and a script leaves no
// shipment row behind, so that container looked unreceived.
//
// Amounts are NOT hard-coded. The script reads Erply's own registration
// documents and writes off only where the SAME product appears in both the
// old and the new document with the SAME amount. Equal amounts are what
// distinguishes "this shipment was counted twice" from "this SKU genuinely
// arrived on two containers" -- P273810-60cm is the latter (1,056 on 09-03,
// 372 today) and is correctly left alone.
//
// Three guards before anything is written:
//   1. Erply's current stock must be >= the amount being removed.
//   2. The resulting figure must equal products.stock_qty in Supabase.
//      The catalog is the reference here because its last stock sync ran
//      BEFORE the duplicate apply, so it still holds the pre-duplicate
//      truth. A mismatch means something else moved as well -- stop and
//      look, do not write. Override with --skip-catalog-check if you have
//      a reason.
//   3. Dry run unless --apply, and a backup CSV is written first.
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
//                         NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')
const SKIP_CATALOG_CHECK = process.argv.includes('--skip-catalog-check')
const argOf = (name, fallback) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=')[1].split(',').map((n) => Number(n.trim())).filter(Boolean) : fallback
}
const OLD_DOCS = argOf('old', [44, 45])   // the earlier, legitimate registration
const NEW_DOCS = argOf('new', [51])       // the duplicate one
const REASON_ID = (argOf('reason', [])[0]) ?? null
const WAREHOUSE_ID = 1

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

const db = createClient(SUPABASE_URL, SERVICE_KEY)

async function erplyPost(params) {
  const res = await fetch(`https://${CC}.erply.com/api/`, {
    method: 'POST',
    body: new URLSearchParams({ clientCode: CC, ...params }),
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
  username: process.env.ERPLY_USERNAME,
  password: process.env.ERPLY_PASSWORD,
})).records[0].sessionKey

// ── 1. The two registrations, from Erply itself ───────────────────────────────
const regs = await erplyPost({ request: 'getInventoryRegistrations', sessionKey, recordsOnPage: '100', getRows: '1' })
const byDoc = new Map((regs.records ?? []).map((r) => [Number(r.inventoryRegistrationID), r]))
for (const id of [...OLD_DOCS, ...NEW_DOCS]) {
  if (!byDoc.has(id)) { console.error(`Erply has no inventory registration ${id}`); process.exit(1) }
}
const sumRows = (ids) => {
  const m = new Map()
  for (const id of ids) {
    for (const row of byDoc.get(id).rows ?? []) {
      const pid = Number(row.productID)
      m.set(pid, (m.get(pid) ?? 0) + Number(row.amount || 0))
    }
  }
  return m
}
const oldQty = sumRows(OLD_DOCS)
const newQty = sumRows(NEW_DOCS)
console.log(`old docs ${OLD_DOCS.join('+')}: ${oldQty.size} products`)
console.log(`new docs ${NEW_DOCS.join('+')}: ${newQty.size} products`)

// ── 2. Stock + codes, straight from Erply ─────────────────────────────────────
const info = new Map()
let pageNo = 1, total = Infinity, seen = 0
while (seen < total) {
  const d = await erplyPost({ request: 'getProducts', sessionKey, recordsOnPage: '500', pageNo: String(pageNo), getStockInfo: '1' })
  total = d.status.recordsTotal ?? 0
  for (const p of d.records) {
    info.set(p.productID, { sku: p.code, name: p.name, stock: Number(p.warehouses?.[String(WAREHOUSE_ID)]?.totalInStock ?? 0) })
  }
  seen += d.records.length
  if (!d.records.length) break
  pageNo++
}

// ── 3. Only equal amounts are duplicates ──────────────────────────────────────
const duplicates = []
const differing = []
for (const [pid, qty] of newQty) {
  if (!oldQty.has(pid)) continue
  if (oldQty.get(pid) === qty) duplicates.push({ pid, qty })
  else differing.push({ pid, old: oldQty.get(pid), now: qty })
}

if (differing.length) {
  console.log(`\nAlso in both, but with DIFFERENT amounts -- treated as genuine separate arrivals, not touched:`)
  differing.forEach((d) => console.log(`  ${info.get(d.pid)?.sku ?? d.pid}: ${d.old.toLocaleString()} then ${d.now.toLocaleString()}`))
}

if (duplicates.length === 0) { console.log('\nNo duplicate rows found. Nothing to do.'); process.exit(0) }

// ── 4. Guards ─────────────────────────────────────────────────────────────────
const { data: catalogRows } = await db
  .from('products')
  .select('sku, stock_qty')
  .in('sku', duplicates.map((d) => info.get(d.pid)?.sku).filter(Boolean))
const catalogBySku = new Map((catalogRows ?? []).map((r) => [r.sku.toUpperCase(), r.stock_qty]))

console.log(`\n${duplicates.length} product(s) stocked twice with the same amount:\n`)
console.log('SKU              Erply now   remove   -> after   catalog   ok?')
let blocked = 0
const plan = []
for (const d of duplicates) {
  const i = info.get(d.pid)
  const after = i.stock - d.qty
  const cat = catalogBySku.get(i.sku.toUpperCase())
  const catOk = cat === undefined ? null : cat === after
  const problem = i.stock < d.qty ? 'STOCK TOO LOW' : (catOk === false && !SKIP_CATALOG_CHECK ? 'CATALOG MISMATCH' : '')
  if (problem) blocked++
  else plan.push({ ...d, sku: i.sku, before: i.stock, after })
  console.log(`${i.sku.padEnd(16)} ${String(i.stock).padStart(9)} ${String(d.qty).padStart(8)} ${String(after).padStart(9)} ${String(cat ?? '-').padStart(9)}   ${problem || 'yes'}`)
}
const totalPieces = plan.reduce((n, p) => n + p.qty, 0)
console.log(`\nwould write off ${totalPieces.toLocaleString()} pieces across ${plan.length} product(s)`)
if (blocked) {
  console.error(`\n${blocked} row(s) failed a guard -- nothing will be written until that is resolved.`)
  process.exit(1)
}
if (!APPLY) { console.log('\nDry run. Re-run with --apply to write off.'); process.exit(0) }

// ── 5. Write off, then verify by re-reading ───────────────────────────────────
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const csvPath = path.join(ROOT, 'data', `stock-writeoff-${stamp}.csv`)
fs.writeFileSync(
  csvPath,
  ['sku,productID,stock_before,removed,expected_after']
    .concat(plan.map((p) => [p.sku, p.pid, p.before, p.qty, p.after].join(',')))
    .join('\n') + '\n',
)
console.log(`\nBackup written: ${path.relative(ROOT, csvPath)}`)

// Erply requires a reasonID on a write-off (it does not on a registration --
// "Erply error 1010: reasonID" is what you get without one). The reason lands
// on the inventory report, so it is a bookkeeping choice, not a default worth
// guessing: `node -e` getReasonCodes lists what the account has.
if (!REASON_ID) {
  console.error(
    '\nMissing --reason=<reasonID>. Erply rejects a write-off without one.\n' +
    'Reason codes on this account: 1 samples, 2 depreciation, 3 broken items, 4 warehouse leftovers.\n' +
    'None of them says "correction", so pick deliberately -- or add a clearer one in Erply first.',
  )
  process.exit(1)
}

const params = { request: 'saveInventoryWriteOff', sessionKey, warehouseID: String(WAREHOUSE_ID), reasonID: String(REASON_ID) }
plan.forEach((p, idx) => {
  params[`productID${idx + 1}`] = String(p.pid)
  params[`amount${idx + 1}`] = String(p.qty)
})
const res = await erplyPost(params)
console.log(`saveInventoryWriteOff -> ${res.status?.responseStatus}, document ${res.records?.[0]?.inventoryWriteOffID ?? '?'}`)

console.log('\nverifying against a fresh read:')
let wrong = 0
for (const p of plan) {
  const d = await erplyPost({ request: 'getProducts', sessionKey, code: p.sku, getStockInfo: '1' })
  const now = Number((d.records ?? [])[0]?.warehouses?.[String(WAREHOUSE_ID)]?.totalInStock ?? 0)
  const ok = now === p.after
  if (!ok) wrong++
  console.log(`  ${p.sku.padEnd(16)} ${p.before} -> ${now} (expected ${p.after}) ${ok ? 'ok' : 'MISMATCH'}`)
}
console.log(wrong === 0 ? '\nAll corrected figures confirmed in Erply.' : `\n${wrong} product(s) did not land as expected -- check Erply.`)
