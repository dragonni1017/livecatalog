// deep-review-category.mjs
// Run with: node scripts/deep-review-category.mjs <SheetName>
//   e.g. node scripts/deep-review-category.mjs Plush
//
// Generalized version of the Squishy-specific review this session started
// with (deep-review-squishy.mjs) -- reads one category sheet out of
// data/qbd-catalog-compare/805-new-products-review.xlsx and checks every
// row against live Erply (not just Supabase -- Erply is the source of
// truth and the two can drift) and Cloudinary, flagging:
//   - likely samples/non-sellable items
//   - names that reference a clearly different product category (possible
//     QB mis-filing under this prefix)
//   - SKUs that already exist in Erply (would be a duplicate create)
//   - SKUs that already have a Cloudinary image sitting under that exact
//     public_id
//
// Read-only. Writes a NEW xlsx to
// data/qbd-catalog-compare/<category>-review-enriched.xlsx (lowercased,
// spaces/slashes replaced with "-").
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
// CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

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

const CATEGORY = process.argv[2]
if (!CATEGORY) {
  console.error('Usage: node scripts/deep-review-category.mjs <SheetName>')
  process.exit(1)
}

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET

// Every other known QB prefix word from this batch (see
// fix-fullqbd-sku-prefixes.mjs's header) -- used as the "does this name
// mention a DIFFERENT product type" signal. The current category's own
// word(s) are excluded at call time below.
const ALL_PREFIX_WORDS = [
  'backpack', 'balloon', 'battery', 'beannie', 'bubbles', 'coin purse',
  'eraser', 'fans', 'flowers', 'gift bags', 'hair band', 'headband',
  'keychains', 'mesh ball', 'pens', 'plush', 'purses', 'silicon bag',
  'slime', 'slipper', 'socks', 'speakers', 'squeeze ball', 'squishy',
  'toys', 'umbrella',
]

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
  const sheet = wb.Sheets[CATEGORY]
  if (!sheet) {
    console.error(`Sheet "${CATEGORY}" not found. Available: ${wb.SheetNames.join(', ')}`)
    process.exit(1)
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })
  console.log(`${CATEGORY} rows:`, rows.length)

  const sampleFlags = rows.filter((r) => /\bsample/i.test(r.proposed_name))
  console.log(`\nFlagged as "sample" (likely not sellable): ${sampleFlags.length}`)
  sampleFlags.forEach((r) => console.log(`  ${r.proposed_sku}: "${r.proposed_name}"`))

  const categoryWordLower = CATEGORY.toLowerCase()
  const otherWords = ALL_PREFIX_WORDS.filter((w) => !categoryWordLower.includes(w) && !w.includes(categoryWordLower))
  const otherCategoryWordsRe = new RegExp(`\\b(${otherWords.join('|')})\\b`, 'i')
  const mismatched = rows.filter((r) => otherCategoryWordsRe.test(r.proposed_name))
  console.log(`\nFlagged as possibly mis-filed under "${CATEGORY}" (name mentions a different product type): ${mismatched.length}`)
  mismatched.forEach((r) => console.log(`  ${r.proposed_sku}: "${r.proposed_name}"`))

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
  const alreadyInErply = rows.filter((r) => erplyBySku.has(String(r.proposed_sku).toUpperCase()))
  console.log(`${CATEGORY} SKUs that ALREADY exist in Erply (despite no Supabase match): ${alreadyInErply.length}`)
  alreadyInErply.forEach((r) => {
    const e = erplyBySku.get(String(r.proposed_sku).toUpperCase())
    console.log(`  ${r.proposed_sku}: QBD="${r.proposed_name}" | Erply="${e.name}" (productID ${e.productID})`)
  })

  console.log('\nChecking Cloudinary for exact-SKU-match images...')
  const cloudinaryIds = await fetchAllCloudinaryPublicIds()
  console.log(`  ${cloudinaryIds.size} Cloudinary resources`)
  const hasCloudinaryImage = rows.filter((r) => cloudinaryIds.has(String(r.proposed_sku)))
  console.log(`${CATEGORY} SKUs with an existing Cloudinary image (exact public_id match): ${hasCloudinaryImage.length}`)
  hasCloudinaryImage.forEach((r) => console.log(`  ${r.proposed_sku}: "${r.proposed_name}"`))

  console.log('\n=== FINAL COUNTS ===')
  console.log(`Total ${CATEGORY} rows:`, rows.length)
  console.log('Flagged sample/non-sellable:', sampleFlags.length)
  console.log('Flagged possibly mis-filed:', mismatched.length)
  console.log('Already in Erply:', alreadyInErply.length)
  console.log('Has Cloudinary image already:', hasCloudinaryImage.length)

  const sampleSkuSet = new Set(sampleFlags.map((r) => r.proposed_sku))
  const mismatchedSkuSet = new Set(mismatched.map((r) => r.proposed_sku))
  const erplySkuSet = new Set(alreadyInErply.map((r) => r.proposed_sku))
  const cloudinarySkuSet = new Set(hasCloudinaryImage.map((r) => r.proposed_sku))

  const enriched = rows.map((r) => {
    const notes = []
    if (sampleSkuSet.has(r.proposed_sku)) notes.push('LIKELY A SAMPLE, NOT A SELLABLE PRODUCT -- exclude unless confirmed otherwise')
    if (mismatchedSkuSet.has(r.proposed_sku)) notes.push(`name mentions another product type -- confirm this belongs under ${CATEGORY} / has the right name`)
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
  XLSX.utils.book_append_sheet(wbOut, ws, `${CATEGORY} Review`.slice(0, 31))
  const safeName = categoryWordLower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const outPath = path.join(ROOT, 'data', 'qbd-catalog-compare', `${safeName}-review-enriched.xlsx`)
  XLSX.writeFile(wbOut, outPath)
  console.log('\nWrote', path.relative(ROOT, outPath))
}

main().catch((e) => { console.error(e); process.exit(1) })
