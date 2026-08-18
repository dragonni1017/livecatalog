// push-recent-backfill-images-to-woo.mjs
// Run with: node scripts/push-recent-backfill-images-to-woo.mjs [--apply]
//
// The 34 SKUs backfilled with images earlier this session (31 exact +
// 3 verified prefix matches, all manually_hidden on livecatalog) were only
// pushed to Cloudinary/Supabase, not WooCommerce. Checking WooCommerce
// directly found 19 of the 34 have no image there either -- and
// importantly, manually_hidden is a livecatalog/Supabase-only concept
// that has no effect on WooCommerce visibility, so 9 of those 19 are
// status=publish (genuinely live/orderable on the real ly-usa.com store
// right now, with no photo at all). Pushes images to WooCommerce directly
// for all 19, same pattern as push-plush-gap-images-to-woo.mjs.
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// afterward to confirm.
//
// Requires in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET

import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET
for (const [name, val] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const SKUS = [
  'F287043', 'T642065', 'F286547-PK', 'F287044', 'F287045', 'T641081-s',
  'D751052-3D Egg', 'F287279-Pp', 'P273677-M', 'T641640-Multi', 'T641664-Red',
  'F287497-1', 'T641545-1', 'F287277-1', 'F287279-R', 'P273678-L',
  'F286606-PUR', 'P273811-60cm', 'F286501-VIO',
]

function wooAuthHeader() {
  return `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}`
}

async function getWooBySku(sku) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&status=any`, { headers: { Authorization: wooAuthHeader() } })
  const data = await res.json()
  return data[0] ?? null
}

async function setWooImage(id, imageUrl) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/${id}`, {
    method: 'PUT',
    headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: [{ src: imageUrl }] }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`WooCommerce update HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

async function main() {
  const { data: products, error } = await supabase.from('products').select('sku, name, image_url').in('sku', SKUS)
  if (error) throw new Error(error.message)
  const bySku = new Map(products.map((p) => [p.sku, p]))

  console.log(`${SKUS.length} products to push:`)
  for (const sku of SKUS) {
    const p = bySku.get(sku)
    if (!p?.image_url) { console.error(`ABORT: ${sku} has no Supabase image_url.`); process.exit(1) }
    console.log(`  ${sku}: "${p.name}" <- ${p.image_url}`)
  }

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to write these to WooCommerce.')
    return
  }

  for (const sku of SKUS) {
    const p = bySku.get(sku)
    const wp = await getWooBySku(sku)
    if (!wp) { console.error(`  FAILED ${sku}: not found in WooCommerce`); continue }
    try {
      await setWooImage(wp.id, p.image_url)
      console.log(`  updated ${sku} (woo id ${wp.id}, status ${wp.status})`)
    } catch (err) {
      console.error(`  FAILED ${sku}: ${err.message}`)
    }
  }

  console.log('\nIndependently re-fetching to confirm...')
  for (const sku of SKUS) {
    const wp = await getWooBySku(sku)
    console.log(`  ${sku}: images=${wp?.images?.length ?? 0}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
