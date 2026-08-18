// push-new-plush-images-to-woo.mjs
// Run with: node scripts/push-new-plush-images-to-woo.mjs [--apply]
//
// The 12 new plush products (create-missing-plush-in-erply.mjs) already
// synced into WooCommerce via Erply's own Products sync (confirmed live,
// all 12 status=publish) but with 0 images each -- expected, since
// "Product image" sync is toggled off account-wide in Erply's WooCommerce
// Integration (a past incident, Dragon declined re-enabling it). This
// pushes images directly to WooCommerce per-product instead, bypassing
// that disabled sync -- same direct-write pattern as
// scripts/set-woo-outofstock-no-image-not-1000.mjs used for stock status.
//
// Sources the image URL from Supabase's image_url (already uploaded to
// Cloudinary this session) for whichever of the 12 SKUs actually has one.
// 2 of the 12 (P273810-60cm Unicorn, P273803-60cm Highland Cow) still have
// no photo anywhere -- skipped, not fabricated.
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// each product afterward to confirm.
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

function wooAuthHeader() {
  return `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}`
}

const SKUS = [
  'P273812-60cm', 'P273815-60cm', 'P273798-60cm', 'P273805-60cm',
  'P273807-46cm', 'P273810-46cm', 'P273810-60cm', 'P273816-46cm',
  'P273800-46cm', 'P273803-60cm', 'P273798-46cm', 'P273802-46cm',
]

async function getWooProductBySku(sku) {
  const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&status=any`
  const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
  if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} for sku ${sku}`)
  const batch = await res.json()
  return batch[0] ?? null
}

async function setWooProductImage(id, imageUrl) {
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
  const { data: products, error } = await supabase.from('products').select('sku, image_url').in('sku', SKUS)
  if (error) throw new Error(error.message)
  const bySku = new Map(products.map((p) => [p.sku, p.image_url]))

  const plan = []
  for (const sku of SKUS) {
    const imageUrl = bySku.get(sku)
    if (!imageUrl) {
      console.log(`  SKIP ${sku}: no Supabase image_url (still no photo found)`)
      continue
    }
    plan.push({ sku, imageUrl })
  }

  console.log(`\n${plan.length}/${SKUS.length} SKUs have an image to push to WooCommerce:`)
  for (const p of plan) console.log(`  ${p.sku} <- ${p.imageUrl}`)

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to write these to WooCommerce.')
    return
  }

  for (const p of plan) {
    const wooProduct = await getWooProductBySku(p.sku)
    if (!wooProduct) {
      console.error(`  FAILED ${p.sku}: not found in WooCommerce`)
      continue
    }
    try {
      await setWooProductImage(wooProduct.id, p.imageUrl)
      console.log(`  updated ${p.sku} (woo id ${wooProduct.id})`)
    } catch (err) {
      console.error(`  FAILED ${p.sku}: ${err.message}`)
    }
  }

  console.log('\nIndependently re-fetching to confirm...')
  for (const p of plan) {
    const check = await getWooProductBySku(p.sku)
    console.log(`  ${p.sku}: images=${check?.images?.length ?? 0} ${check?.images?.[0]?.src ?? ''}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
