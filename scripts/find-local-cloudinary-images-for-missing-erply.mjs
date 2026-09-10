// Read-only, one-off. Finds active Erply products with no CDN image, then
// checks whether a candidate image exists (a) as a local file under
// data/images/** or (b) already sitting in the Cloudinary account (even if
// products.image_url in Supabase was never set to it). Writes nothing.
import fs from 'fs'
import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = 'C:\\Users\\Dragon\\Downloads\\livecatalog\\livecatalog'
config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
let sessionKey = null
let cdnJwt = null

async function erplyLogin() {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  const json = await res.json()
  sessionKey = json.records[0].sessionKey
  cdnJwt = json.records[0].token
}

async function erplyPost(params) {
  if (!sessionKey) await erplyLogin()
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, sessionKey, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  const json = await res.json()
  return json
}

async function fetchActiveProducts() {
  async function page(pageNo) {
    const data = await erplyPost({ request: 'getProducts', recordsOnPage: '300', pageNo: String(pageNo), active: '1' })
    return { products: data.records, total: data.status.recordsTotal ?? 0 }
  }
  const first = await page(1)
  const all = [...first.products]
  let pageNo = 2
  while (all.length < first.total) {
    const { products } = await page(pageNo)
    if (products.length === 0) break
    all.push(...products)
    pageNo++
  }
  return all.map((p) => ({ productID: p.productID, sku: (p.code || String(p.productID)).trim(), name: p.name ?? '' }))
}

const STOPWORDS = new Set(['pk', 'bx', 'cs', 'pack', 'box', 'boxes', 'case', 'cases', 'and', 'with', 'for', 'of', 'in', 'the', 'a', 'an', 'set', 'sets', 'pcs', 'pc', 'ct', 'dz', 'dozen', 'per', 'each', 'style', 'styles', 'new', 'img', 'jpg', 'jpeg', 'png', 'webp'])

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
}

async function fetchCdnProductIdsWithImage() {
  if (!cdnJwt) await erplyLogin()
  const withImage = new Set()
  let pageNo = 1
  let total = Infinity
  let seen = 0
  while (seen < total) {
    const res = await fetch(`https://cdn.erply.com/images?page=${pageNo}`, { headers: { JWT: cdnJwt } })
    const data = await res.json()
    total = data.totalRecords
    for (const img of data.images) {
      if (img.isDeleted || img.context !== 'erply-product') continue
      withImage.add(img.productId)
    }
    seen += data.images.length
    if (data.images.length === 0) break
    pageNo++
  }
  return withImage
}

function walkLocalFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkLocalFiles(full))
    else if (/\.(jpe?g|png|webp|gif)$/i.test(entry.name)) out.push(full)
  }
  return out
}

function baseSkuOf(filename) {
  const noExt = filename.replace(/\.[a-z0-9]+$/i, '')
  // strip Windows duplicate-download suffixes like " (2)", " (3)" and trailing whitespace
  const noCopySuffix = noExt.replace(/\s*\(\d+\)\s*$/, '').trim()
  return noCopySuffix.toUpperCase()
}

function fetchCloudinaryPage(nextCursor) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ max_results: '500' })
    if (nextCursor) qs.set('next_cursor', nextCursor)
    const AUTH = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')
    https.get({ hostname: 'api.cloudinary.com', path: `/v1_1/${CLOUD_NAME}/resources/image?${qs}`, headers: { Authorization: `Basic ${AUTH}` } }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  })
}

async function fetchAllCloudinaryPublicIds() {
  let all = []
  let cursor = null
  do {
    const result = await fetchCloudinaryPage(cursor)
    all = all.concat((result.resources || []).map((r) => r.public_id))
    cursor = result.next_cursor || null
  } while (cursor)
  return all
}

async function main() {
  console.log('Fetching active Erply products + CDN image set...')
  const products = await fetchActiveProducts()
  const cdnHasImage = await fetchCdnProductIdsWithImage()
  const missing = products.filter((p) => !cdnHasImage.has(p.productID))
  console.log(`${missing.length} active Erply products have no CDN image.`)

  console.log('Scanning local image folders for image files...')
  const LOCAL_ROOTS = [
    path.join(ROOT, 'data', 'images'),
    'C:\\Users\\Dragon\\Downloads\\02_Photos',
  ]
  const localFiles = LOCAL_ROOTS.flatMap((dir) => (fs.existsSync(dir) ? walkLocalFiles(dir) : []))
  const localExactBySku = new Map() // SKU -> path
  const localPrefixBySku = new Map() // base SKU (before first '-') -> [paths]
  for (const f of localFiles) {
    const filename = path.basename(f)
    const sku = baseSkuOf(filename)
    if (!localExactBySku.has(sku)) localExactBySku.set(sku, f)
    const prefix = sku.split('-')[0]
    if (!localPrefixBySku.has(prefix)) localPrefixBySku.set(prefix, [])
    localPrefixBySku.get(prefix).push(f)
  }
  console.log(`  ${localFiles.length} local image files found across ${LOCAL_ROOTS.join(', ')}`)

  console.log('Fetching full Cloudinary resource list (live account)...')
  const cloudPublicIds = await fetchAllCloudinaryPublicIds()
  const cloudExactBySku = new Map()
  const cloudPrefixBySku = new Map()
  for (const pid of cloudPublicIds) {
    const filename = pid.split('/').pop()
    const sku = filename.toUpperCase()
    if (!cloudExactBySku.has(sku)) cloudExactBySku.set(sku, pid)
    const underscoreIdx = sku.indexOf('_')
    const usku = underscoreIdx > -1 ? sku.slice(0, underscoreIdx) : sku
    const prefix = usku.split('-')[0]
    if (!cloudPrefixBySku.has(prefix)) cloudPrefixBySku.set(prefix, [])
    cloudPrefixBySku.get(prefix).push(pid)
  }
  console.log(`  ${cloudPublicIds.length} images in Cloudinary account`)

  let localExact = 0, localPrefix = 0, cloudExact = 0, cloudPrefix = 0, anyMatch = 0, none = 0
  const noneList = []
  const reviewRows = []
  for (const p of missing) {
    const sku = p.sku.toUpperCase()
    const base = sku.split('-')[0]
    const hasLocalExact = localExactBySku.has(sku)
    const hasLocalPrefix = !hasLocalExact && localPrefixBySku.has(base)
    const hasCloudExact = cloudExactBySku.has(sku)
    const hasCloudPrefix = !hasCloudExact && cloudPrefixBySku.has(base)
    if (hasLocalExact) localExact++
    if (hasLocalPrefix) localPrefix++
    if (hasCloudExact) cloudExact++
    if (hasCloudPrefix) cloudPrefix++
    if (hasLocalExact || hasLocalPrefix || hasCloudExact || hasCloudPrefix) {
      anyMatch++
      const localCandidates = hasLocalExact ? [localExactBySku.get(sku)] : (hasLocalPrefix ? localPrefixBySku.get(base) : [])
      const cloudCandidates = hasCloudExact ? [cloudExactBySku.get(sku)] : (hasCloudPrefix ? cloudPrefixBySku.get(base) : [])
      reviewRows.push({
        sku: p.sku,
        productID: p.productID,
        matchType: hasLocalExact || hasCloudExact ? 'exact' : 'variant-suffix',
        localCandidates: localCandidates.join(' | '),
        cloudCandidates: cloudCandidates.join(' | '),
      })
    } else { none++; noneList.push(p.sku) }
  }

  const escR = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const reviewCsv = ['sku,productID,matchType,localCandidates,cloudCandidates']
  for (const r of reviewRows) reviewCsv.push([escR(r.sku), r.productID, escR(r.matchType), escR(r.localCandidates), escR(r.cloudCandidates)].join(','))
  fs.writeFileSync(path.join(ROOT, 'data', 'images', 'erply-missing-review-candidates.csv'), reviewCsv.join('\n') + '\n')

  console.log(`\nOf ${missing.length} active Erply products with no CDN image:`)
  console.log(`  Exact local filename match:     ${localExact}`)
  console.log(`  Local match via base-SKU prefix (variant file only): ${localPrefix}`)
  console.log(`  Exact match in Cloudinary account: ${cloudExact}`)
  console.log(`  Cloudinary match via base-SKU prefix (variant only): ${cloudPrefix}`)
  console.log(`  ANY match (local file or Cloudinary, exact or prefix): ${anyMatch}`)
  console.log(`  Genuinely no match anywhere: ${none}`)
  console.log(`\nWrote ${reviewRows.length} candidates for review to data/images/erply-missing-review-candidates.csv`)

  fs.writeFileSync(path.join(ROOT, 'data', 'images', 'erply-missing-with-no-source-image.csv'), 'sku\n' + noneList.join('\n') + '\n')
  console.log(`\nWrote ${noneList.length} truly-no-source SKUs to data/images/erply-missing-with-no-source-image.csv`)

  // Name-based fuzzy pass, only over the SKUs that had zero SKU-code match,
  // against local files not already claimed by a SKU-code match. Purely a
  // review aid -- word overlap between product name and filename/folder
  // path is not proof of a correct match, just a candidate to eyeball.
  console.log('\nRunning name-based fuzzy pass over unmatched SKUs vs unclaimed local files...')
  const claimedFiles = new Set()
  for (const f of localExactBySku.values()) claimedFiles.add(f)
  for (const arr of localPrefixBySku.values()) for (const f of arr) claimedFiles.add(f)

  const candidates = localFiles
    .filter((f) => !claimedFiles.has(f))
    .map((f) => {
      const rel = path.relative(ROOT, f).length < f.length ? path.relative(ROOT, f) : f
      const parts = rel.split(path.sep)
      const nameableParts = parts.slice(0, -1).slice(-2).concat(path.basename(f, path.extname(f)))
      return { file: f, tokens: new Set(tokenize(nameableParts.join(' '))) }
    })
    .filter((c) => c.tokens.size > 0)

  const noneSet = new Set(noneList.map((s) => s.toUpperCase()))
  const missingWithName = missing.filter((p) => noneSet.has(p.sku.toUpperCase()))

  const fuzzyRows = []
  for (const p of missingWithName) {
    const nameTokens = tokenize(p.name)
    if (nameTokens.length === 0) continue
    let best = null
    for (const c of candidates) {
      let overlap = 0
      const matched = []
      for (const t of nameTokens) {
        if (c.tokens.has(t)) { overlap++; matched.push(t) }
      }
      if (overlap >= 2 && (!best || overlap > best.overlap)) {
        best = { file: c.file, overlap, matched }
      }
    }
    if (best) fuzzyRows.push({ sku: p.sku, name: p.name, file: best.file, overlap: best.overlap, matched: best.matched.join('|') })
  }

  console.log(`  ${fuzzyRows.length} of ${missingWithName.length} unmatched SKUs have a name-overlap candidate (overlap >= 2 significant words) -- REVIEW, not confirmed.`)
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csvLines = ['sku,name,candidateFile,wordOverlap,matchedWords']
  for (const r of fuzzyRows) csvLines.push([esc(r.sku), esc(r.name), esc(r.file), r.overlap, esc(r.matched)].join(','))
  fs.writeFileSync(path.join(ROOT, 'data', 'images', 'erply-missing-name-fuzzy-candidates.csv'), csvLines.join('\n') + '\n')
  console.log(`  Wrote data/images/erply-missing-name-fuzzy-candidates.csv`)
}

main().catch((err) => { console.error(err); process.exit(1) })
