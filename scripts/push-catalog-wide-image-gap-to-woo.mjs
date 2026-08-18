// push-catalog-wide-image-gap-to-woo.mjs
// Run with: node scripts/push-catalog-wide-image-gap-to-woo.mjs [--apply]
//
// Full-catalog version of push-plush-gap-images-to-woo.mjs / push-new-
// plush-images-to-woo.mjs: 164 active, visible (not manually_hidden),
// published-on-Woo products have a Supabase/Cloudinary image_url but no
// image in WooCommerce -- the same account-wide Erply image-sync gap
// (Product image sync toggled off, declined to re-enable, see
// docs/memory/project-erply-image-backfill.md), now confirmed to span
// the whole catalog, not just Plush. Pushes images directly to
// WooCommerce via the batch update endpoint (much faster than 164
// sequential single-product PUTs).
//
// Recomputes the gap list live (does not hardcode the 164 SKUs) so this
// is accurate at run time, not a stale snapshot from the audit that found
// it.
//
// Defaults to a dry run; pass --apply to write. Writes a backup CSV
// before any writes, and independently re-fetches every SKU afterward to
// confirm (WooCommerce batch responses aren't trustworthy on their own --
// see docs/memory/project-woo-direct-outofstock-write.md).
//
// Requires in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')
const BATCH_SIZE = 50

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

const OUT_DIR = path.join(ROOT, 'data', 'catalog-wide-woo-image-gap')
const OUT_CSV = path.join(OUT_DIR, 'planned-changes.csv')

async function main() {
  console.log('Fetching active Supabase products with an image_url...')
  let supProducts = []
  {
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('products')
        .select('sku,name,image_url,manually_hidden')
        .eq('is_active', true)
        .not('image_url', 'is', null)
        .range(from, from + 999)
      if (error) throw new Error(error.message)
      supProducts = supProducts.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
  }
  console.log(`  ${supProducts.length} candidates`)

  console.log('Fetching all WooCommerce products...')
  let wooProducts = []
  {
    let page = 1
    while (true) {
      const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=100&page=${page}&status=any&_fields=id,sku,status,images`, { headers: { Authorization: wooAuthHeader() } })
      const batch = await res.json()
      if (!Array.isArray(batch) || batch.length === 0) break
      wooProducts = wooProducts.concat(batch)
      if (batch.length < 100) break
      page++
    }
  }
  const wooBySku = new Map(wooProducts.map((p) => [(p.sku || '').trim().toUpperCase(), p]))
  console.log(`  ${wooProducts.length} WooCommerce products\n`)

  const gap = []
  for (const p of supProducts) {
    if (p.manually_hidden) continue
    const wp = wooBySku.get((p.sku || '').trim().toUpperCase())
    if (!wp) continue
    if (wp.status !== 'publish') continue
    if ((wp.images?.length ?? 0) > 0) continue
    gap.push({ sku: p.sku, name: p.name, imageUrl: p.image_url, wooId: wp.id })
  }

  console.log(`${gap.length} products to push (recomputed live).`)
  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to write these to WooCommerce.')
    console.log('Sample (first 10):')
    for (const g of gap.slice(0, 10)) console.log(`  ${g.sku} (woo id ${g.wooId}) <- ${g.imageUrl}`)
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = ['sku,woo_id,image_url,name', ...gap.map((g) => [g.sku, g.wooId, g.imageUrl, esc(g.name)].join(','))].join('\n') + '\n'
  fs.writeFileSync(OUT_CSV, csv)
  console.log(`Backup written to ${path.relative(ROOT, OUT_CSV)}`)

  console.log('\nBatch-updating WooCommerce...')
  let updated = 0
  let failed = 0
  for (let i = 0; i < gap.length; i += BATCH_SIZE) {
    const chunk = gap.slice(i, i + BATCH_SIZE)
    const body = { update: chunk.map((g) => ({ id: g.wooId, images: [{ src: g.imageUrl }] })) }
    const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/batch`, {
      method: 'POST',
      headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      failed += chunk.length
      console.error(`  batch ${i / BATCH_SIZE + 1} FAILED: HTTP ${res.status}: ${text.slice(0, 300)}`)
      continue
    }
    updated += chunk.length
    console.log(`  batch ${i / BATCH_SIZE + 1}: ${chunk.length} products updated`)
  }
  console.log(`\nBatch calls done. ${updated} attempted-ok, ${failed} failed.`)

  console.log('\nIndependently re-fetching every SKU to confirm (not trusting the batch response)...')
  let confirmed = 0
  const stillMissing = []
  for (const g of gap) {
    const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/${g.wooId}?_fields=sku,images`, { headers: { Authorization: wooAuthHeader() } })
    const wp = await res.json()
    if ((wp.images?.length ?? 0) > 0) {
      confirmed++
    } else {
      stillMissing.push(g.sku)
    }
  }
  console.log(`\nConfirmed with an image: ${confirmed}/${gap.length}`)
  if (stillMissing.length) {
    console.log(`Still missing (${stillMissing.length}): ${stillMissing.join(', ')}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
