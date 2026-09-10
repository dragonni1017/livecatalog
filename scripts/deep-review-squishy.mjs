import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { config } from 'dotenv'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  const json = await res.json()
  if (json.status?.responseStatus === 'error') throw new Error(`Erply error ${json.status.errorCode}`)
  return json
}

function fetchCloudinaryPage(nextCursor) {
  return new Promise((resolve, reject) => {
    const AUTH = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')
    const qs = new URLSearchParams({ max_results: '500' })
    if (nextCursor) qs.set('next_cursor', nextCursor)
    https.get({ hostname: 'api.cloudinary.com', path: `/v1_1/${CLOUD_NAME}/resources/image?${qs}`, headers: { Authorization: `Basic ${AUTH}` } }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}
async function fetchAllCloudinaryPublicIds() {
  let all = []
  let cursor = null
  do {
    const result = await fetchCloudinaryPage(cursor)
    if (result.error) throw new Error(result.error.message)
    all = all.concat((result.resources || []).map((r) => r.public_id))
    cursor = result.next_cursor || null
  } while (cursor)
  return new Set(all)
}

async function main() {
  const wb = XLSX.readFile(path.join(ROOT, 'data', 'qbd-catalog-compare', '805-new-products-review.xlsx'))
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Squishy'], { defval: null })
  console.log('Squishy rows:', rows.length)

  // -- flag sample/non-sellable items --
  const sampleFlags = rows.filter(r => /\bsample/i.test(r.proposed_name))
  console.log('\nFlagged as "sample" (likely not sellable):', sampleFlags.length)
  sampleFlags.forEach(r => console.log(`  ${r.proposed_sku}: "${r.proposed_name}"`))

  // -- flag names that reference a clearly different product category than Squishy --
  const otherCategoryWords = /\b(backpack|purse|umbrella|keychain|headband|pen|eraser|balloon|speaker|hair\s*band|coin\s*purse)\b/i
  const mismatched = rows.filter(r => otherCategoryWords.test(r.proposed_name))
  console.log('\nFlagged as possibly mis-filed under "Squishy" (name mentions a different product type):', mismatched.length)
  mismatched.forEach(r => console.log(`  ${r.proposed_sku}: "${r.proposed_name}"`))

  // -- check live Erply for any of these SKUs already existing (Supabase said no, but Erply is the real source of truth) --
  console.log('\nChecking live Erply for existing SKUs...')
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey
  const erplyBySku = new Map()
  let pageNo = 1, total = Infinity, fetched = 0
  while (fetched < total) {
    const data = await erplyPost({ request: 'getProducts', sessionKey, recordsOnPage: '500', pageNo: String(pageNo) })
    total = data.status.recordsTotal ?? 0
    for (const p of data.records) { const c = (p.code || '').trim().toUpperCase(); if (c) erplyBySku.set(c, p) }
    fetched += data.records.length
    if (data.records.length === 0) break
    pageNo++
  }
  console.log(`  ${erplyBySku.size} Erply products loaded`)
  const alreadyInErply = rows.filter(r => erplyBySku.has(String(r.proposed_sku).toUpperCase()))
  console.log('Squishy SKUs that ALREADY exist in Erply (despite no Supabase match):', alreadyInErply.length)
  alreadyInErply.forEach(r => {
    const e = erplyBySku.get(String(r.proposed_sku).toUpperCase())
    console.log(`  ${r.proposed_sku}: QBD="${r.proposed_name}" | Erply="${e.name}" (productID ${e.productID})`)
  })

  // -- check Cloudinary for an exact-SKU-match image already sitting there --
  console.log('\nChecking Cloudinary for exact-SKU-match images...')
  const cloudinaryIds = await fetchAllCloudinaryPublicIds()
  console.log(`  ${cloudinaryIds.size} Cloudinary resources`)
  const hasCloudinaryImage = rows.filter(r => cloudinaryIds.has(String(r.proposed_sku)))
  console.log('Squishy SKUs with an existing Cloudinary image (exact public_id match):', hasCloudinaryImage.length)
  hasCloudinaryImage.forEach(r => console.log(`  ${r.proposed_sku}: "${r.proposed_name}"`))

  console.log('\n=== FINAL COUNTS ===')
  console.log('Total Squishy rows:', rows.length)
  console.log('Flagged sample/non-sellable:', sampleFlags.length)
  console.log('Flagged possibly mis-filed:', mismatched.length)
  console.log('Already in Erply:', alreadyInErply.length)
  console.log('Has Cloudinary image already:', hasCloudinaryImage.length)
  const cleanCount = rows.length - sampleFlags.length - alreadyInErply.length
  console.log('Clean candidates (not sample, not already in Erply):', cleanCount)

  // -- write the enriched review file, using the real per-row results above --
  const sampleSkuSet = new Set(sampleFlags.map((r) => r.proposed_sku))
  const mismatchedSkuSet = new Set(mismatched.map((r) => r.proposed_sku))
  const erplySkuSet = new Set(alreadyInErply.map((r) => r.proposed_sku))
  const cloudinarySkuSet = new Set(hasCloudinaryImage.map((r) => r.proposed_sku))

  const enriched = rows.map((r) => {
    const notes = []
    if (sampleSkuSet.has(r.proposed_sku)) notes.push('LIKELY A SAMPLE, NOT A SELLABLE PRODUCT -- exclude unless confirmed otherwise')
    if (mismatchedSkuSet.has(r.proposed_sku) && r.proposed_sku !== 'B323529') notes.push('name mentions another product type (e.g. keychain) -- likely a real squishy-keychain hybrid, just double check category fit')
    if (r.proposed_sku === 'B323529') notes.push('name does NOT mention "squishy" at all ("Backpack Lady Bug") -- confirm this really belongs here / has the right name before creating')
    if (erplySkuSet.has(r.proposed_sku)) notes.push('ALREADY EXISTS IN ERPLY -- do not create, this would be a duplicate')
    if (!r.qb_price) notes.push('NO PRICE -- needs a real price before this can be created')
    return {
      ...r,
      has_cloudinary_image: cloudinarySkuSet.has(r.proposed_sku) ? 'yes' : 'no',
      already_in_erply: erplySkuSet.has(r.proposed_sku) ? 'yes' : 'no',
      review_notes: notes.join(' | '),
    }
  })

  const ws = XLSX.utils.json_to_sheet(enriched)
  ws['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 50 }, { wch: 18 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 55 },
  ]
  ws['!autofilter'] = { ref: ws['!ref'] }
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'Squishy Review')
  const outPath = path.join(ROOT, 'data', 'qbd-catalog-compare', 'squishy-review-enriched.xlsx')
  XLSX.writeFile(wbOut, outPath)
  console.log('\nWrote', path.relative(ROOT, outPath))
}

main().catch(e => { console.error(e); process.exit(1) })
