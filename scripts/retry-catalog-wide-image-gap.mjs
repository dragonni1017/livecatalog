// retry-catalog-wide-image-gap.mjs
// Run with: node scripts/retry-catalog-wide-image-gap.mjs [--apply]
//
// push-catalog-wide-image-gap-to-woo.mjs's batch call reported 164/164
// "updated" but an independent re-fetch found 60 still had no image --
// same "don't trust the batch response" lesson as
// docs/memory/project-woo-direct-outofstock-write.md, just for images
// this time instead of stock_status. The 60 URLs were confirmed valid
// (curl -I returns 200, correct content-type) so this isn't a bad-URL
// problem -- looks like a transient server-side media-sideload issue
// during the large batch call. Retries just those 60 via individual PUT
// requests (the pattern that worked reliably for the smaller 12- and
// 7-product batches earlier this session) instead of the batch endpoint.
//
// Reads the SKU list from data/catalog-wide-woo-image-gap/planned-
// changes.csv (written by the script above) rather than recomputing,
// since the 60 "still missing" list was already independently confirmed.
//
// Defaults to a dry run; pass --apply to write.
//
// Requires in .env.local:
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')

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

const STILL_MISSING = [
  'F286505','B325070','F287849','F286749','F284020','F287875','B325027','F285346','C801005','F284122',
  'F286610','C801015','F286376','F287789','F286629','F286801','F286667','F287851','F286802','F286797',
  'H424261','B325068','H424181','F287051','F286630','F286459','F287174','F287173','F287171','F287175',
  'F287877','F286787','F286635','H424251','F287878','C801021','B325039','B325043','K229355','B325076',
  'F286800','B325073','K229366','F286744','F287848','F286862','F286631','H424250','F287850','F287792',
  'K229361','H424183','F286748','F286799','F286380','F286628','F287547','F286605','F287876','F287881',
]

const CSV_PATH = path.join(ROOT, 'data', 'catalog-wide-woo-image-gap', 'planned-changes.csv')

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const rows = []
  for (const line of lines.slice(1)) {
    const [sku, wooId, imageUrl] = line.split(',')
    rows.push({ sku, wooId, imageUrl })
  }
  return rows
}

const EXT_BY_CONTENT_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// WordPress's media sideload determines MIME type from the URL's file
// extension, not the actual Content-Type header -- these 60 Cloudinary
// URLs have no extension at all (e.g. ".../upload/F286505"), so WP
// rejects them with "not allowed to upload this file type" even though
// the real content is a valid image. Cloudinary serves the same asset
// with an explicit extension appended, so fetch the real Content-Type
// via HEAD and append the matching extension before pushing.
async function withRealExtension(url) {
  if (/\.[a-z]{3,4}$/i.test(url)) return url // already has one
  const res = await fetch(url, { method: 'HEAD' })
  const contentType = res.headers.get('content-type')
  const ext = EXT_BY_CONTENT_TYPE[contentType]
  if (!ext) throw new Error(`Unrecognized content-type "${contentType}" for ${url}`)
  return `${url}.${ext}`
}

async function setWooImage(id, imageUrl) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/${id}`, {
    method: 'PUT',
    headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: [{ src: imageUrl }] }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

async function main() {
  const allRows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'))
  const bySku = new Map(allRows.map((r) => [r.sku, r]))
  const targets = STILL_MISSING.map((sku) => bySku.get(sku)).filter(Boolean)

  console.log(`${targets.length}/${STILL_MISSING.length} found in the backup CSV.`)
  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to retry these individually.')
    return
  }

  let ok = 0
  let failed = 0
  for (const t of targets) {
    try {
      const fixedUrl = await withRealExtension(t.imageUrl)
      await setWooImage(t.wooId, fixedUrl)
      ok++
      console.log(`  updated ${t.sku} (woo id ${t.wooId}) <- ${fixedUrl}`)
    } catch (err) {
      failed++
      console.error(`  FAILED ${t.sku}: ${err.message}`)
    }
  }
  console.log(`\n${ok} succeeded, ${failed} failed.`)

  console.log('\nIndependently re-fetching to confirm...')
  let confirmed = 0
  const stillMissing = []
  for (const t of targets) {
    const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/${t.wooId}?_fields=sku,images`, { headers: { Authorization: wooAuthHeader() } })
    const wp = await res.json()
    if ((wp.images?.length ?? 0) > 0) confirmed++
    else stillMissing.push(t.sku)
  }
  console.log(`Confirmed with an image: ${confirmed}/${targets.length}`)
  if (stillMissing.length) console.log(`Still missing: ${stillMissing.join(', ')}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
