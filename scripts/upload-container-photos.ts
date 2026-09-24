// upload-container-photos.ts
// Run with: node scripts/upload-container-photos.ts                 (dry run)
//           node scripts/upload-container-photos.ts --apply
//           node scripts/upload-container-photos.ts --dir="C:/path/to/folder" --apply
//           node scripts/upload-container-photos.ts --replace --apply
//
// Uploads the per-container photo folders that arrive alongside a shipment
// (Downloads/<CONTAINER>Photos/, plus "New Photos") to Cloudinary and points
// the matching catalog rows at them. Same conventions as
// upload-images-to-cloudinary.ts and upload-new-plush-photos.ts:
// public_id = SKU, then image_url + image_urls + needs_photo = false.
//
// Filename -> SKU, in this order, because SKUs contain hyphens and digits of
// their own (P273814-45cm is a product; B325123-1 is a second photo of
// B325123):
//   1. " (2)" and " (3)" download markers are stripped -- Chrome adds those
//      when the same file is downloaded twice, they are not part of the name.
//   2. An exact, case-insensitive match against products.sku wins.
//   3. Only if that fails, a trailing -1/-2/-3 is treated as an extra view of
//      the SKU in front of it. Extra views are appended to image_urls after
//      the primary, in numeric order.
//
// Files matching no SKU are listed, never guessed at. Most of them are real
// products that just have not been created yet -- the photos for a container
// usually arrive before its arrival list is staged.
//
// By default a product that ALREADY has an image_url is left alone (listed as
// skipped) -- pass --replace to overwrite those too. Dry run by default;
// --apply uploads and writes, and records every change in a CSV under data/.
//
// Requires in .env.local: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
//   CLOUDINARY_API_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { matchFilesToProducts } from '../lib/photo-matching.ts'
import { readImageFiles } from './photo-files.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')
const REPLACE = process.argv.includes('--replace')
const dirArgs = process.argv.filter((a) => a.startsWith('--dir=')).map((a) => a.slice(6).replace(/^"|"$/g, ''))

const DOWNLOADS = 'C:/Users/Dragon/Downloads'
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
for (const [name, val] of Object.entries({ CLOUD_NAME, API_KEY, API_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
// Checked immediately above; narrowed here so the rest of the file can use
// them without repeating the assertion.
const cloudName = CLOUD_NAME as string
const apiKey = API_KEY as string
const apiSecret = API_SECRET as string

const supabase = createClient(SUPABASE_URL as string, SUPABASE_SERVICE_KEY as string, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function signParams(params: Record<string, string | number>): string {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex')
}

async function uploadToCloudinary(filePath: string, publicId: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signParams({ public_id: publicId, timestamp })
  const buffer = fs.readFileSync(filePath)
  const form = new FormData()
  form.append('file', new Blob([buffer]), path.basename(filePath))
  form.append('api_key', apiKey)
  form.append('timestamp', String(timestamp))
  form.append('public_id', publicId)
  form.append('signature', signature)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form })
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message || `HTTP ${res.status}`)
  return json.secure_url
}

// 1. Folders to scan.
const folders = dirArgs.length
  ? dirArgs
  : fs.readdirSync(DOWNLOADS)
      .filter((f) => /^[A-Z]{4}\d+Photos$/.test(f) || f === 'New Photos')
      .map((f) => path.join(DOWNLOADS, f))
      .filter((f) => fs.statSync(f).isDirectory())

console.log(`Scanning ${folders.length} folder(s):`)
folders.forEach((f) => console.log(`  ${f}`))

// Matching rules live in ./photo-matching.ts so that
// find-photos-for-missing-images.ts reports exactly what this will upload.
const files = readImageFiles(folders)
console.log(`\n${files.length} image file(s) found`)

// 2. Catalog rows.
const products = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name, image_url, image_urls, needs_photo')
    .range(from, from + 999)
  if (error) { console.error(error.message); process.exit(1) }
  products.push(...(data ?? []))
  if ((data ?? []).length < 1000) break
}
const bySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p]))

// 3. Match files to products -- shared with find-photos-for-missing-images.ts.
const { plan, unmatched } = matchFilesToProducts(files, bySku)

const entries = [...plan.values()].sort((a, b) => a.product.sku.localeCompare(b.product.sku))
const withImage = entries.filter((e) => e.product.image_url)
const todo = REPLACE ? entries : entries.filter((e) => !e.product.image_url)

console.log(`\n${entries.length} product(s) matched by filename`)
console.log(`  ${todo.length} to upload${REPLACE ? ' (--replace: existing images overwritten)' : ''}`)
console.log(`  ${withImage.length} already have an image${REPLACE ? '' : ' (skipped — pass --replace to overwrite)'}`)
const dupeCount = entries.reduce((n, e) => n + e.dupes.length, 0)
console.log(`  ${unmatched.length} file(s) matched no SKU`)
console.log(`  ${dupeCount} duplicate file(s) ignored (same SKU and view, downloaded twice)\n`)

for (const e of todo) {
  const views = e.views.sort((a: { n: number }, b: { n: number }) => a.n - b.n)
  const names = [e.primary?.name, ...views.map((v) => v.file.name)].filter(Boolean)
  console.log(`  ${e.product.sku.padEnd(20)} ${names.length} file(s): ${names.join(', ')}`)
}
if (unmatched.length) {
  console.log('\nNo product with this SKU (usually a container not staged yet):')
  const byDir: Record<string, string[]> = {}
  unmatched.forEach((f) => { (byDir[path.basename(f.dir)] ??= []).push(f.stem) })
  for (const [dir, stems] of Object.entries(byDir)) {
    console.log(`  ${dir}: ${[...new Set(stems)].join(', ')}`)
  }
}

if (!APPLY) {
  console.log('\nDry run — pass --apply to upload and write.')
  process.exit(0)
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const csvRows = [['sku', 'files', 'primary_url', 'all_urls'].join(',')]
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

let done = 0, failed = 0
for (const e of todo) {
  const sku = e.product.sku
  try {
    const urls = []
    if (e.primary) urls.push(await uploadToCloudinary(e.primary.filePath, sku))
    for (const v of e.views.sort((a: { n: number }, b: { n: number }) => a.n - b.n)) {
      urls.push(await uploadToCloudinary(v.file.filePath, `${sku}-${v.n}`))
    }
    if (urls.length === 0) continue
    const { error } = await supabase
      .from('products')
      .update({ image_url: urls[0], image_urls: urls, needs_photo: false })
      .eq('id', e.product.id)
    if (error) throw new Error(error.message)
    csvRows.push([sku, urls.length, esc(urls[0]), esc(urls.join(' '))].join(','))
    console.log(`  ${sku}: ${urls.length} image(s) -> ${urls[0]}`)
    done++
  } catch (err) {
    console.error(`  FAILED ${sku}: ${(err as Error).message}`)
    failed++
  }
}

const csvPath = path.join(ROOT, 'data', `container-photos-uploaded-${stamp}.csv`)
fs.writeFileSync(csvPath, csvRows.join('\n') + '\n')
console.log(`\nUploaded ${done} product(s), ${failed} failed. Log: ${path.relative(ROOT, csvPath)}`)

// Independent re-read rather than trusting the writes.
const { data: after } = await supabase
  .from('products')
  .select('sku, image_url, needs_photo')
  .in('sku', todo.map((e) => e.product.sku))
const stillMissing = (after ?? []).filter((p) => !p.image_url)
console.log(stillMissing.length === 0
  ? 'Verified: every updated product reads back with an image_url.'
  : `Still without an image_url: ${stillMissing.map((p) => p.sku).join(', ')}`)
