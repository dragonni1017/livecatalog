// set-woo-outofstock-no-image-not-1000.mjs
// Run with: node scripts/set-woo-outofstock-no-image-not-1000.mjs           (dry run)
//           node scripts/set-woo-outofstock-no-image-not-1000.mjs --apply    (writes)
//
// Writes directly to WooCommerce (ly-usa.com), NOT through Erply -- different
// from every other write script in this repo. Confirmed with Dragon
// 2026-08-17 before running: flip every Woo product that is currently
// stock_status=instock, has NO image, and does NOT read stock_quantity=1000
// (i.e. wasn't part of the deliberate connectivity-test stock write, see
// docs/memory/project-erply-pagination-fix.md) to stock_status=outofstock.
// Dragon flagged this to the team that now owns the live WooCommerce site
// before approving the run (same handoff as
// docs/memory/project-woo-price-integration-markup-bug.md).
//
// Includes BOTH draft and published products matching the filter -- Dragon
// explicitly confirmed including the ~75 live/published ones too, not just
// the ~66 harmless drafts (see chat transcript 2026-08-17).
//
// KNOWN RISK, accepted by Dragon: Erply is still the source of truth feeding
// Woo's stock on some schedule (see the still-open image-sync-lag finding in
// docs/memory/project-erply-image-backfill.md) -- a future Erply->Woo sync
// could silently revert this direct Woo write if Erply's own stock/status
// for these SKUs disagrees. This script does not touch Erply at all.
//
// Safety, matching this repo's established pattern for bulk writes:
// - Dry run by default, --apply required to write.
// - Writes a backup CSV (id, sku, name, oldStatus, newStatus, manageStock,
//   stockQuantity, postStatus) to
//   data/woo-outofstock-no-image/planned-changes.csv BEFORE any writes.
// - Writes via wc/v3 batch update (100 products/call, WooCommerce's own cap).
// - After --apply, re-fetches live status independently to confirm the
//   write landed -- never trusts the batch response alone.
//
// Requires in .env.local: WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET
// (same as compare-erply-woo.mjs -- but the key needs WRITE permission this
// time, not just Read, or the apply step will 401/403.)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET

for (const [name, val] of Object.entries({ WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}

function wooAuthHeader() {
  return `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}`
}

const OUT_DIR = path.join(ROOT, 'data', 'woo-outofstock-no-image')
const OUT_CSV = path.join(OUT_DIR, 'planned-changes.csv')
const BATCH_SIZE = 100

async function fetchAllWooProducts() {
  const perPage = 100
  let pageNo = 1
  const all = []
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=${perPage}&page=${pageNo}&status=any`
    const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on page ${pageNo}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < perPage) break
    pageNo++
  }
  return all
}

function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = 'id,sku,name,oldStatus,newStatus,manageStock,stockQuantity,postStatus'
  const lines = rows.map((r) =>
    [r.id, r.sku, esc(r.name), r.oldStatus, r.newStatus, r.manageStock, r.stockQuantity, r.postStatus].join(','),
  )
  return [header, ...lines].join('\n') + '\n'
}

async function batchUpdateStockStatus(ids) {
  const body = { update: ids.map((id) => ({ id, stock_status: 'outofstock' })) }
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/batch`, {
    method: 'POST',
    headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`WooCommerce batch HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

async function main() {
  const apply = process.argv.includes('--apply')

  console.log('Fetching full WooCommerce catalog (status=any)...')
  const all = await fetchAllWooProducts()
  console.log(`  ${all.length} total Woo products\n`)

  const candidates = all.filter((p) =>
    p.stock_status === 'instock' &&
    (!Array.isArray(p.images) || p.images.length === 0) &&
    Number(p.stock_quantity) !== 1000,
  )

  const changes = candidates.map((p) => ({
    id: p.id,
    sku: p.sku || '',
    name: p.name,
    oldStatus: p.stock_status,
    newStatus: 'outofstock',
    manageStock: p.manage_stock,
    stockQuantity: p.stock_quantity,
    postStatus: p.status,
  }))

  const published = changes.filter((c) => c.postStatus === 'publish').length
  const draft = changes.length - published

  console.log(`=== Dry run summary ===`)
  console.log(`instock, no image, stock_quantity != 1000: ${changes.length}`)
  console.log(`  published (live, customer-facing):  ${published}`)
  console.log(`  draft/other (not customer-facing):  ${draft}`)
  console.log('\nSample (first 10):')
  for (const c of changes.slice(0, 10)) {
    console.log(`  ${c.sku || '(no sku)'} | ${c.name.slice(0, 45)} | manage_stock=${c.manageStock} qty=${c.stockQuantity} postStatus=${c.postStatus}`)
  }

  if (!apply) {
    console.log(`\nDry run only -- zero writes made. Re-run with --apply to flip ${changes.length} products to outofstock.`)
    return
  }

  if (changes.length === 0) {
    console.log('\nNothing to apply. Done.')
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_CSV, toCsv(changes))
  console.log(`\nBackup of planned changes written to ${path.relative(ROOT, OUT_CSV)} before any writes.`)

  console.log(`\n--apply set. Flipping ${changes.length} products to outofstock, batches of ${BATCH_SIZE}...`)
  let ok = 0
  let failed = 0
  const failedSkus = []
  for (let i = 0; i < changes.length; i += BATCH_SIZE) {
    const chunk = changes.slice(i, i + BATCH_SIZE)
    try {
      const result = await batchUpdateStockStatus(chunk.map((c) => c.id))
      const updated = result.update ?? []
      const succeeded = updated.filter((u) => !u.error).length
      const chunkFailed = updated.filter((u) => u.error)
      ok += succeeded
      failed += chunkFailed.length
      chunkFailed.forEach((u) => failedSkus.push(`id=${u.id}: ${u.error?.message ?? 'unknown error'}`))
      console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}: ${succeeded}/${chunk.length} updated`)
    } catch (err) {
      failed += chunk.length
      chunk.forEach((c) => failedSkus.push(`${c.sku}: ${err.message}`))
      console.error(`  batch ${Math.floor(i / BATCH_SIZE) + 1} FAILED (${chunk.length} products): ${err.message}`)
    }
  }
  console.log(`\nDone. ${ok} updated, ${failed} failed.`)
  if (failedSkus.length) console.log('Failures:\n  ' + failedSkus.join('\n  '))

  console.log('\nRe-fetching live status to independently verify the write...')
  const reAll = await fetchAllWooProducts()
  const reById = new Map(reAll.map((p) => [p.id, p.stock_status]))
  let verified = 0
  let mismatched = 0
  const mismatchSamples = []
  for (const c of changes) {
    const live = reById.get(c.id)
    if (live === 'outofstock') {
      verified++
    } else {
      mismatched++
      if (mismatchSamples.length < 10) mismatchSamples.push(`  ${c.sku}: expected outofstock, live is ${live ?? 'MISSING'}`)
    }
  }
  console.log(`Verified matching live: ${verified}/${changes.length}`)
  if (mismatched) {
    console.log(`MISMATCHED: ${mismatched}`)
    console.log(mismatchSamples.join('\n'))
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
