// backfill-missing-images-from-local-to-cloudinary.mjs
// Run with: node scripts/backfill-missing-images-from-local-to-cloudinary.mjs
//
// Maximizes Cloudinary/Supabase image coverage for every ACTIVE product that
// currently has no products.image_url, using two sources, cheapest first:
//
//   Phase A (free -- no upload): Cloudinary already has 2,183 images but
//   Supabase only shows image_url set on 2,159 products -- some images are
//   sitting in the Cloudinary account under a SKU's exact public_id with
//   nothing in Supabase pointing at them. Just relink those, no upload.
//
//   Phase B: for whatever's still missing, walk every known local image
//   folder (data/images/** and the Downloads/02_Photos tree) for a file
//   whose name -- after stripping the extension and a Windows duplicate-
//   download suffix like " (2)" -- matches the SKU EXACTLY. Only exact
//   matches auto-upload; same-base-but-different-variant files (e.g.
//   F287456-BLUE.webp when the target is F287456-AQUA BLUE) are proven
//   unreliable (see data/images/erply-missing-review-candidates.csv from
//   the earlier investigation) and are deliberately NOT auto-applied here.
//
// Resumable: appends to data/images/local-to-cloudinary-backfill-results.csv,
// skips SKUs already logged "uploaded"/"relinked" on a re-run.
//
// Run with: node scripts/backfill-missing-images-from-local-to-cloudinary.mjs
//           node scripts/backfill-missing-images-from-local-to-cloudinary.mjs --dry-run
//           node scripts/backfill-missing-images-from-local-to-cloudinary.mjs --limit=20
//
// Requires in .env.local: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
// CLOUDINARY_API_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Meant to run locally (needs the local Downloads/02_Photos folder + a fast
// connection to Cloudinary), not in a sandbox.

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

for (const [name, val] of Object.entries({ CLOUD_NAME, API_KEY, API_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}

const DRY_RUN = process.argv.includes('--dry-run')
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const LOCAL_ROOTS = [
  path.join(ROOT, 'data', 'images'),
  'C:\\Users\\Dragon\\Downloads\\02_Photos',
]
const RESULTS_PATH = path.join(ROOT, 'data', 'images', 'local-to-cloudinary-backfill-results.csv')

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
  const noCopySuffix = noExt.replace(/\s*\(\d+\)\s*$/, '').trim()
  return noCopySuffix.toUpperCase()
}

// ---- Cloudinary ----
function fetchCloudinaryPage(nextCursor) {
  return new Promise((resolve, reject) => {
    const AUTH = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')
    const qs = new URLSearchParams({ max_results: '500' })
    if (nextCursor) qs.set('next_cursor', nextCursor)
    fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/image?${qs}`, { headers: { Authorization: `Basic ${AUTH}` } })
      .then((r) => r.json())
      .then(resolve)
      .catch(reject)
  })
}

async function fetchAllCloudinary() {
  let all = []
  let cursor = null
  do {
    const result = await fetchCloudinaryPage(cursor)
    if (result.error) throw new Error(result.error.message)
    all = all.concat(result.resources || [])
    cursor = result.next_cursor || null
  } while (cursor)
  return all
}

function signParams(params) {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return crypto.createHash('sha1').update(toSign + API_SECRET).digest('hex')
}

async function uploadToCloudinary(filePath, publicId) {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signParams({ public_id: publicId, timestamp })
  const buffer = fs.readFileSync(filePath)
  const form = new FormData()
  form.append('file', new Blob([buffer]), path.basename(filePath))
  form.append('api_key', API_KEY)
  form.append('timestamp', String(timestamp))
  form.append('public_id', publicId)
  form.append('signature', signature)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: form })
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message || `HTTP ${res.status}`)
  return json.secure_url
}

// ---- results log ----
function loadDoneSkus() {
  if (!fs.existsSync(RESULTS_PATH)) return new Set()
  const lines = fs.readFileSync(RESULTS_PATH, 'utf8').trim().split('\n').slice(1)
  const done = new Set()
  const unquote = (s) => (s ?? '').replace(/^"|"$/g, '')
  for (const line of lines) {
    const [sku, , status] = line.split(',')
    if (['relinked', 'uploaded'].includes(unquote(status))) done.add(unquote(sku))
  }
  return done
}
function appendResults(rows) {
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true })
  if (!fs.existsSync(RESULTS_PATH)) fs.writeFileSync(RESULTS_PATH, 'sku,url,status,message\n')
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  fs.appendFileSync(RESULTS_PATH, rows.map((r) => `${esc(r.sku)},${esc(r.url)},${esc(r.status)},${esc(r.message)}\n`).join(''))
}

async function main() {
  console.log('Loading active Supabase products missing image_url...')
  const missing = [] // { sku, ids: [] }
  const bySkuIds = new Map()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('products').select('id, sku, image_url, is_active').range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    for (const row of data) {
      if (!row.is_active || row.image_url) continue
      const key = (row.sku || '').trim().toUpperCase()
      if (!key) continue
      if (!bySkuIds.has(key)) bySkuIds.set(key, [])
      bySkuIds.get(key).push(row.id)
    }
    if (data.length < PAGE) break
  }
  console.log(`  ${bySkuIds.size} active SKUs have no image_url`)

  console.log('Fetching Cloudinary resource list...')
  const cloudResources = await fetchAllCloudinary()
  const cloudBySku = new Map(cloudResources.map((r) => [r.public_id.toUpperCase(), r]))
  console.log(`  ${cloudResources.length} images in Cloudinary account`)

  const alreadyDone = loadDoneSkus()
  console.log(`  ${alreadyDone.size} SKUs already logged done (resuming, will skip)`)

  // ---- Phase A: relink SKUs Cloudinary already has, free ----
  const relinkTodo = []
  for (const sku of bySkuIds.keys()) {
    if (alreadyDone.has(sku)) continue
    const res = cloudBySku.get(sku)
    if (res) relinkTodo.push({ sku, url: res.secure_url })
  }
  console.log(`\nPhase A -- already in Cloudinary, just needs relinking: ${relinkTodo.length}`)

  // ---- Phase B: local file exact match for whatever's left ----
  console.log('\nScanning local image folders...')
  const localFiles = LOCAL_ROOTS.flatMap((dir) => (fs.existsSync(dir) ? walkLocalFiles(dir) : []))
  const localBySku = new Map() // sku -> [{filePath, size}]
  for (const f of localFiles) {
    const sku = baseSkuOf(path.basename(f))
    if (!localBySku.has(sku)) localBySku.set(sku, [])
    localBySku.get(sku).push({ filePath: f, size: fs.statSync(f).size })
  }
  console.log(`  ${localFiles.length} local image files scanned`)

  const relinkSkus = new Set(relinkTodo.map((r) => r.sku))
  const uploadTodo = []
  for (const sku of bySkuIds.keys()) {
    if (alreadyDone.has(sku) || relinkSkus.has(sku)) continue
    const candidates = localBySku.get(sku)
    if (!candidates || candidates.length === 0) continue
    const smallest = candidates.reduce((a, b) => (b.size < a.size ? b : a))
    uploadTodo.push({ sku, filePath: smallest.filePath })
  }
  console.log(`Phase B -- exact local file match, needs upload: ${uploadTodo.length}`)

  const noSource = bySkuIds.size - relinkTodo.length - uploadTodo.length - alreadyDone.size
  console.log(`Still no source anywhere (unchanged from before): ${noSource}`)

  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity

  if (DRY_RUN) {
    console.log('\n--dry-run passed -- not writing. Sample of what would happen:')
    console.log('Relink sample:', relinkTodo.slice(0, 10).map((r) => r.sku))
    console.log('Upload sample:', uploadTodo.slice(0, 10).map((r) => `${r.sku} <- ${r.filePath}`))
    return
  }

  let relinked = 0, uploaded = 0, failed = 0, dbUpdated = 0

  async function applyToSupabase(sku, url) {
    const ids = bySkuIds.get(sku) || []
    if (!ids.length) return
    const { error } = await supabase.from('products').update({ image_url: url, image_urls: [url] }).in('id', ids)
    if (error) console.log(`  DB update failed for ${sku}: ${error.message}`)
    else dbUpdated += ids.length
  }

  for (const { sku, url } of relinkTodo.slice(0, limit)) {
    await applyToSupabase(sku, url)
    relinked++
    appendResults([{ sku, url, status: 'relinked', message: '' }])
    if (relinked % 25 === 0) console.log(`  relinked ${relinked}/${relinkTodo.length}`)
  }

  const uploadLimit = Math.max(0, limit - relinked)
  for (const { sku, filePath } of uploadTodo.slice(0, uploadLimit)) {
    try {
      const url = await uploadToCloudinary(filePath, sku)
      await applyToSupabase(sku, url)
      uploaded++
      appendResults([{ sku, url, status: 'uploaded', message: filePath }])
      console.log(`  OK ${sku}`)
    } catch (err) {
      failed++
      appendResults([{ sku, url: '', status: 'error', message: err.message }])
      console.log(`  FAIL ${sku}: ${err.message}`)
    }
  }

  console.log(`\nDone. relinked=${relinked} uploaded=${uploaded} failed=${failed} products_updated=${dbUpdated}`)
  console.log(`Log: data/images/local-to-cloudinary-backfill-results.csv`)
}

main().catch((err) => { console.error('Fatal error:', err); process.exit(1) })
