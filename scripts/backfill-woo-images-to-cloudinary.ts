// backfill-woo-images-to-cloudinary.ts
// Run with: node scripts/backfill-woo-images-to-cloudinary.ts            (dry run)
//           node scripts/backfill-woo-images-to-cloudinary.ts --apply
//
// For catalog products with no image_url whose WooCommerce listing DOES have
// photos (the "wooHasImage" rows of find-truly-missing-images.mjs), copies
// the Woo photos into Cloudinary and points the catalog row at them. Same
// conventions as upload-container-photos.ts: public_id = SKU (a "/" or space
// in the SKU becomes "_", Cloudinary would read "/" as a folder), then
// image_url + image_urls + needs_photo = false.
//
// Only touches rows with no image_url, so it never replaces an existing photo.
// Writes nothing to Woo or Erply, and does not change visibility -- a hidden
// product stays hidden. --apply records every change in a CSV under data/.
//
// Requires in .env.local: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
//   CLOUDINARY_API_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { uploadToCloudinary } from '../lib/cloudinary.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')

const env = (k: string) => {
  const v = process.env[k]
  if (!v) { console.error(`Missing in .env.local: ${k}`); process.exit(1) }
  return v
}
for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) env(k)
const rawWoo = env('WOO_STORE_URL')
const WOO = (/^https?:\/\//i.test(rawWoo) ? rawWoo : `https://${rawWoo}`).replace(/\/+$/, '')
const WOO_AUTH = 'Basic ' + Buffer.from(`${env('WOO_CONSUMER_KEY')}:${env('WOO_CONSUMER_SECRET')}`).toString('base64')
const supabase = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

const publicIdFor = (sku: string) => sku.trim().replace(/\s*\/\s*/g, '_').replace(/\s+/g, '_')

async function fetchWooImages(): Promise<Map<string, string[]>> {
  const bySku = new Map<string, string[]>()
  for (let page = 1; ; page++) {
    const res = await fetch(`${WOO}/wp-json/wc/v3/products?per_page=100&page=${page}&status=any`, {
      headers: { Authorization: WOO_AUTH },
    })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on page ${page}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const p of batch) {
      const urls = (p.images ?? []).map((i: { src?: string }) => i.src).filter(Boolean)
      if (p.sku && urls.length) bySku.set(String(p.sku).trim().toLowerCase(), urls)
    }
    if (batch.length < 100) break
  }
  return bySku
}

async function fetchImagelessProducts() {
  const rows: { id: string; sku: string; name: string; manually_hidden: boolean }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, name, manually_hidden')
      .is('image_url', null)
      .range(from, from + 999)
    if (error) throw new Error(`Supabase: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows.filter((r) => r.sku)
}

console.log('Fetching WooCommerce products...')
const woo = await fetchWooImages()
console.log(`  ${woo.size} Woo products with photos`)
const products = await fetchImagelessProducts()
console.log(`  ${products.length} catalog products with no image`)

const todo = products
  .map((p) => ({ ...p, urls: woo.get(p.sku.trim().toLowerCase()) ?? [] }))
  .filter((p) => p.urls.length)
console.log(`\n${todo.length} can be filled from Woo:\n`)
for (const p of todo) {
  console.log(`  ${p.sku.padEnd(20)} ${String(p.urls.length).padStart(2)} photo(s)  ${p.manually_hidden ? 'hidden ' : 'visible'}  ${p.name.slice(0, 50)}`)
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to upload and update the catalog.')
  process.exit(0)
}

const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
const csv = [['sku', 'files', 'primary_url', 'all_urls', 'woo_urls'].join(',')]
let done = 0
let failed = 0
for (const p of todo) {
  try {
    const base = publicIdFor(p.sku)
    const urls: string[] = []
    for (const [i, src] of p.urls.entries()) {
      const res = await fetch(src)
      if (!res.ok) throw new Error(`download HTTP ${res.status}: ${src}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const name = path.basename(new URL(src).pathname)
      urls.push(await uploadToCloudinary(bytes, i === 0 ? base : `${base}-${i}`, name))
    }
    const { error } = await supabase
      .from('products')
      .update({ image_url: urls[0], image_urls: urls, needs_photo: false })
      .eq('id', p.id)
      .is('image_url', null)
    if (error) throw new Error(`Supabase: ${error.message}`)
    csv.push([esc(p.sku), urls.length, esc(urls[0]), esc(urls.join(' ')), esc(p.urls.join(' '))].join(','))
    done++
    console.log(`  ok   ${p.sku}`)
  } catch (e) {
    failed++
    console.log(`  FAIL ${p.sku}: ${(e as Error).message}`)
  }
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const csvPath = path.join(ROOT, 'data', `woo-images-to-cloudinary-${stamp}.csv`)
fs.writeFileSync(csvPath, csv.join('\n') + '\n')
console.log(`\nUploaded ${done} product(s), ${failed} failed. Log: ${path.relative(ROOT, csvPath)}`)
