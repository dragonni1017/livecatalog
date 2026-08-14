// add-woo-plush-toys-category.mjs
//
// Adds the existing "Plush Toys" WooCommerce category (slug plush-toys) to
// every published product whose name matches /plush|stuffed|teddy|plushie/i
// but isn't in that category yet. Purely additive -- WooCommerce products
// can carry multiple categories, so this never removes a product from its
// current category (Keychains, Slippers, Bags/Purses, etc.), unlike the
// Supabase side (see add-plush-category.mjs) where only one category per
// product is possible and a narrower "core toys only" scope was used
// instead. Confirmed with Dragon 2026-08-11: for Woo, since there's no
// trade-off, include every keyword match regardless of current category.
//
// Run with: node scripts/add-woo-plush-toys-category.mjs           (dry run, default)
//           node scripts/add-woo-plush-toys-category.mjs --apply   (writes via wc/v3/products/batch)
//
// Requires in .env.local: WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')

const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET

const missing = []
if (!WOO_STORE_URL) missing.push('WOO_STORE_URL')
if (!WOO_CONSUMER_KEY) missing.push('WOO_CONSUMER_KEY')
if (!WOO_CONSUMER_SECRET) missing.push('WOO_CONSUMER_SECRET')
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const KEYWORDS = /plush|stuffed|teddy|plushie/i
const PLUSH_TOYS_SLUG = 'plush-toys'

function wooAuthHeader() {
  const token = Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

async function fetchAllProducts() {
  const all = []
  let page = 1
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=100&page=${page}&status=publish`
    const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
    if (!res.ok) throw new Error(`Woo products fetch failed: ${res.status} ${await res.text()}`)
    const batch = await res.json()
    all.push(...batch)
    if (batch.length < 100) break
    page++
  }
  return all
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE — this will write to WooCommerce ===' : '=== DRY RUN (pass --apply to write) ===')

  const products = await fetchAllProducts()
  const plushToysCat = products.flatMap((p) => p.categories).find((c) => c.slug === PLUSH_TOYS_SLUG)
  if (!plushToysCat) throw new Error(`Could not find a "${PLUSH_TOYS_SLUG}" category on any product`)

  const matches = products.filter((p) => KEYWORDS.test(p.name))
  const scope = matches.filter((p) => !p.categories.some((c) => c.slug === PLUSH_TOYS_SLUG))

  console.log(`\n${matches.length} products match plush keywords; ${scope.length} aren't in "Plush Toys" yet.`)
  for (const p of scope) {
    console.log(`  ${p.sku} :: ${p.name} :: currently [${p.categories.map((c) => c.name).join(', ')}]`)
  }

  if (!APPLY) {
    console.log('\nDry run only -- no changes made. Re-run with --apply to write these changes.')
    return
  }

  console.log('\nApplying via wc/v3/products/batch...')
  const updates = scope.map((p) => ({
    id: p.id,
    categories: [...p.categories.map((c) => ({ id: c.id })), { id: plushToysCat.id }],
  }))

  let applied = 0
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100)
    const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/batch`, {
      method: 'POST',
      headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ update: chunk }),
    })
    if (!res.ok) throw new Error(`Batch update failed: ${res.status} ${await res.text()}`)
    const result = await res.json()
    applied += (result.update ?? []).length
  }
  console.log(`\nApplied ${applied}/${scope.length} category additions.`)

  console.log('\nVerifying...')
  const verifyProducts = await fetchAllProducts()
  const verifyById = new Map(verifyProducts.map((p) => [p.id, p]))
  let verified = 0
  for (const p of scope) {
    const fresh = verifyById.get(p.id)
    if (fresh && fresh.categories.some((c) => c.slug === PLUSH_TOYS_SLUG)) verified++
    else console.error(`  NOT VERIFIED: ${p.sku} :: ${p.name}`)
  }
  console.log(`Verified ${verified}/${scope.length} products now carry "Plush Toys".`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
