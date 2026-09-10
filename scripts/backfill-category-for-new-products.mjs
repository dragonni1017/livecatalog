// backfill-category-for-new-products.mjs
// Run with: node scripts/backfill-category-for-new-products.mjs
//
// lib/product-sync.ts's resolveCategories() has a real, silent bug: it
// upserts a new category with only {name, slug}, never an `id` -- but
// categories.id has NO DEFAULT (it's a curated "cat-NNN" sequence, e.g.
// cat-001, cat-052), so the insert fails with a not-null-constraint error
// every single time a genuinely new Erply category name shows up. The
// error is swallowed silently (falls through to a re-select that also
// finds nothing), leaving category_id null on every affected product.
// Confirmed live 2026-09-01: 145 of the 194 brand-new products from
// today's Erply sync have category_id=null because of this.
//
// This script is a narrow, one-off remediation: only touches active
// products that currently have category_id=null. For each one, looks up
// its live Erply group name, creates the category properly (generating the
// next real cat-NNN id) if it doesn't exist yet, and sets category_id.
// Does NOT fix resolveCategories() itself -- that's a separate, deliberate
// change to production sync code, not bundled into this one-off fix.
//
// Run with: node scripts/backfill-category-for-new-products.mjs
//           node scripts/backfill-category-for-new-products.mjs --dry-run
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

for (const [name, val] of Object.entries({ ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}

const DRY_RUN = process.argv.includes('--dry-run')
const sinceArg = process.argv.find((a) => a.startsWith('--since='))
const SINCE = sinceArg ? sinceArg.split('=')[1] : null
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
let sessionKey = null

async function erplyPost(params) {
  if (!sessionKey) {
    const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
    const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
    const json = await res.json()
    sessionKey = json.records[0].sessionKey
  }
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, sessionKey, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  return res.json()
}

// Mirrors lib/erply-category-aliases.ts's ERPLY_CATEGORY_ALIASES -- kept in
// sync manually, same convention as every other scripts/*.mjs that mirrors
// lib/ logic instead of importing it (see preview-erply-sync.mjs header).
async function loadAliasMap() {
  const raw = await import('fs').then((fs) => fs.readFileSync(path.join(ROOT, 'lib', 'erply-category-aliases.ts'), 'utf8'))
  const map = {}
  const re = /'([^']+)':\s*'([^']+)'/g
  let m
  while ((m = re.exec(raw))) map[m[1]] = m[2]
  return map
}

// One-off overlay, reviewed and confirmed with Dragon 2026-09-01: maps the
// 12 raw Erply group names found on today's 194 new products onto EXISTING
// categories instead of letting them become new, uncurated ones (several
// were near-duplicates of existing categories, e.g. "Bag/Purse" vs the
// real "Bags/Purses"). "Uncategorized" (Erply's own no-group fallback) is
// deliberately left unmapped -- those products keep category_id=null
// rather than being forced into a fake category, per Dragon's choice.
// Not merged into lib/erply-category-aliases.ts -- that's the permanent,
// broader fix and needs its own review pass (many more raw names than
// these 12 remain unmapped catalog-wide, see the un-scoped dry-run).
const ONE_OFF_ALIAS_OVERLAY = {
  Keychain: 'Keychains',
  TOY: 'Toys & Novelties',
  Stationary: 'Stationery & Office',
  pen: 'Stationery & Office',
  Ribbon: 'Ribbons',
  Backpack: 'Bags/Purses',
  'Bag/Purse': 'Bags/Purses',
  '3D': '3D Printed',
  'Wrapping Paper': 'Papers',
  'Floral Papers': 'Papers',
  'Gift Boxes': 'Gifts',
}

async function main() {
  console.log('Loading active products with no category_id...')
  let query = supabase.from('products').select('id, sku, category_id').eq('is_active', true).is('category_id', null)
  if (SINCE) query = query.gte('created_at', SINCE)
  const { data: rows, error } = await query
  if (error) { console.error(error.message); process.exit(1) }
  console.log(`  ${rows.length} products with no category${SINCE ? ` (created since ${SINCE})` : ''}`)
  if (rows.length === 0) return

  const aliasMap = await loadAliasMap()

  console.log('Looking up each SKU\'s live Erply group name...')
  const neededCategoryBySku = new Map()
  for (const row of rows) {
    const data = await erplyPost({ request: 'getProducts', code: row.sku })
    const p = data.records?.[0]
    if (!p) continue
    const raw = (p.groupName ?? '').trim()
    if (!raw || raw === 'Uncategorized') continue // deliberately left category_id=null, see ONE_OFF_ALIAS_OVERLAY comment
    const aliased = ONE_OFF_ALIAS_OVERLAY[raw] ?? aliasMap[raw] ?? raw
    neededCategoryBySku.set(row.sku, aliased)
  }

  const neededNames = [...new Set(neededCategoryBySku.values())]
  console.log(`  ${neededNames.length} distinct category names needed`)

  console.log('\nChecking which already exist in Supabase...')
  const { data: existingCats } = await supabase.from('categories').select('id, name').in('name', neededNames)
  const idByName = new Map((existingCats ?? []).map((c) => [c.name, c.id]))
  const missingNames = neededNames.filter((n) => !idByName.has(n))
  console.log(`  ${idByName.size} already exist, ${missingNames.length} need to be created`)

  // Next available cat-NNN id.
  const { data: allCats } = await supabase.from('categories').select('id')
  const maxNum = Math.max(0, ...(allCats ?? []).map((c) => {
    const m = /^cat-(\d+)$/.exec(c.id)
    return m ? parseInt(m[1], 10) : 0
  }))
  let nextNum = maxNum + 1

  console.log(`\nWould create ${missingNames.length} categories starting at cat-${String(nextNum).padStart(3, '0')}:`)
  const toCreate = missingNames.map((name) => {
    const id = `cat-${String(nextNum++).padStart(3, '0')}`
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    return { id, name, slug }
  })
  for (const c of toCreate) console.log(`  ${c.id} -> "${c.name}" (${c.slug})`)

  if (DRY_RUN) {
    console.log('\n--dry-run passed -- not writing.')
    console.log(`Would then update category_id on ${neededCategoryBySku.size} products.`)
    return
  }

  if (toCreate.length > 0) {
    const { error: insErr } = await supabase.from('categories').insert(toCreate)
    if (insErr) { console.error('Category creation failed:', insErr.message); process.exit(1) }
    for (const c of toCreate) idByName.set(c.name, c.id)
    console.log(`\nCreated ${toCreate.length} categories.`)
  }

  let updated = 0, failed = 0
  for (const row of rows) {
    const categoryName = neededCategoryBySku.get(row.sku)
    const categoryId = categoryName ? idByName.get(categoryName) : null
    if (!categoryId) continue
    const { error: updErr } = await supabase.from('products').update({ category_id: categoryId }).eq('id', row.id)
    if (updErr) { console.log(`  FAIL ${row.sku}: ${updErr.message}`); failed++; continue }
    updated++
  }
  console.log(`\nDone. updated=${updated} failed=${failed}`)
}

main().catch((err) => { console.error('Fatal error:', err); process.exit(1) })
