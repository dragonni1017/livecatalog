// push-finished-pics-replace-woo.mjs
// Run with: node scripts/push-finished-pics-replace-woo.mjs [--apply]
//
// The 41 SKUs backfilled/replaced from Downloads/Finished pics/ (see
// upload-finished-pics.mjs) only touched Cloudinary + Supabase. 2 of them
// (P257091, T641291) also had no Woo image and were already pushed via
// push-finished-pics-gap-to-woo.mjs. These remaining 39 already had an
// OLDER image on WooCommerce -- out of sync with the new finished photo
// in Supabase. Dragon confirmed: replace WooCommerce's image with the new
// finished one for these too, so all three systems match.
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
  'K229361', 'K229390', 'K229391', 'K229392', 'K229396', 'K229397',
  'K229407', 'K229408', 'K229410', 'K229421', 'K229423', 'K229424',
  'K229426', 'K229427', 'K229428', 'K229430', 'K229431', 'K229435',
  'K229438', 'K229440', 'K229446', 'K229447', 'K229464', 'K229465',
  'K229466', 'K229472', 'K229473', 'K229475', 'K229481', 'K229482',
  'K229483', 'K229486', 'K229487', 'K229488', 'P257011', 'P257053',
  'P257151', 'P257192', 'P273761',
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

  console.log(`${SKUS.length} products to replace on WooCommerce:`)
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
    console.log(`  ${sku}: images=${wp?.images?.length ?? 0} firstSrc=${wp?.images?.[0]?.src ?? '-'}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
