// export-erply-cdn-url-map.mjs
// Run with: node scripts/export-erply-cdn-url-map.mjs
//
// Read-only. Builds sku -> Erply CDN asset URL for every active product that
// has a live image on Erply's CDN (same source as
// scripts/export-erply-cdn-images-inventory.mjs) and caches it to
// data/erply-cdn-url-map.json. Rebuilding this from scratch (Erply product
// list + paginated CDN image listing) takes ~1 minute, so
// scripts/toggle-image-to-erply-cdn.mjs reads this cache instead of
// re-fetching every time -- re-run this manually if new images get added to
// Erply's CDN and you want the toggle script to see them.
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
if (!ERPLY_CLIENT_CODE || !ERPLY_USERNAME || !ERPLY_PASSWORD) {
  console.error('Missing ERPLY_CLIENT_CODE / ERPLY_USERNAME / ERPLY_PASSWORD in .env.local')
  process.exit(1)
}

const API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(API_URL, { method: 'POST', body })
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function main() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey
  const jwt = auth.records[0].token

  console.log('Fetching active Erply products...')
  const skuByProductId = {}
  let pageNo = 1, total = Infinity, all = []
  while (all.length < total) {
    const data = await erplyPost({ request: 'getProducts', sessionKey, recordsOnPage: '300', pageNo: String(pageNo), active: '1' })
    total = data.status.recordsTotal
    if (!data.records || data.records.length === 0) break
    all.push(...data.records)
    pageNo++
  }
  for (const p of all) skuByProductId[p.productID] = (p.code || String(p.productID)).trim()
  console.log(`  ${all.length} active products`)

  console.log('Fetching Erply CDN image listing (paginated)...')
  const keyByProductId = new Map()
  let cdnPage = 1, cdnTotal = Infinity, seen = 0
  while (seen < cdnTotal) {
    const res = await fetch(`https://cdn.erply.com/images?page=${cdnPage}`, { headers: { JWT: jwt } })
    const d = await res.json()
    cdnTotal = d.totalRecords
    for (const img of d.images) {
      if (img.isDeleted || img.context !== 'erply-product') continue
      const cur = keyByProductId.get(img.productId)
      if (!cur || img.order === 1) keyByProductId.set(img.productId, img.key)
    }
    seen += d.images.length
    if (d.images.length === 0) break
    cdnPage++
  }
  console.log(`  ${keyByProductId.size} distinct products have a live CDN image`)

  const map = {}
  for (const [pid, key] of keyByProductId) {
    const sku = skuByProductId[pid]
    if (sku) map[sku] = `https://cdn.erply.com/assets/${ERPLY_CLIENT_CODE}/image/${key}`
  }

  const outPath = path.join(ROOT, 'data', 'erply-cdn-url-map.json')
  fs.writeFileSync(outPath, JSON.stringify(map, null, 2))
  console.log(`Wrote ${Object.keys(map).length} sku -> Erply CDN URL entries to ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
