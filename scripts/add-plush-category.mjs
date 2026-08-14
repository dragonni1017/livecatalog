// add-plush-category.mjs
//
// Creates a new "Plush" category and moves the plush-toy products currently
// sitting in Toys & Novelties (cat-047) and Flower Bears back out into it.
//
// Note: cat-047 used to BE "Plush Toys" (158 products, the largest of five
// groups) before it was deliberately merged with Toys/Squishy-Slime/Sticks
// Toys/Fidgets/Bubbles into "Toys & Novelties" on 2026-06-25 (see
// docs/CATEGORY-CHANGELOG.md, "EXECUTED -- 2026-06-25"). This script
// re-splits a keyword-matched subset of that merge back out -- narrower
// than a straight revert (only items with plush/stuffed/teddy/plushie in
// the name move, not the whole original 158), confirmed with Dragon
// 2026-08-11 given that history.
//
// Scope: name matches /plush|stuffed|teddy|plushie/i AND currently in
// Toys & Novelties or Flower Bears. Deliberately excludes matches sitting
// in Keychains, Accessories & Apparel, Bags/Purses, or Flowers (e.g. "Plush
// Keychains", "Teddy Bear Sherpa Slippers", "Plushie Mountain Bear
// Backpack") -- Supabase allows only one category per product, so moving
// those would remove their current (arguably more useful) categorization.
// Dragon's call 2026-08-11: core plush toys only, not plush-themed items
// whose primary category is something else.
//
// Run with: node scripts/add-plush-category.mjs           (dry run, default)
//           node scripts/add-plush-category.mjs --apply   (creates category + writes)

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
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials in .env.local.')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const NEW_CATEGORY_ID = 'cat-074'
const NEW_CATEGORY_NAME = 'Plush'
const NEW_CATEGORY_SLUG = 'plush'
const SOURCE_CATEGORY_NAMES = ['Toys & Novelties', 'Flower Bears']
const KEYWORDS = /plush|stuffed|teddy|plushie/i

async function selectAll(makeQuery) {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE — this will write to Supabase ===' : '=== DRY RUN (pass --apply to write) ===')

  const { data: categories, error: catErr } = await supabase.from('categories').select('id, name, slug')
  if (catErr) throw new Error(catErr.message)
  if (categories.some((c) => c.id === NEW_CATEGORY_ID || c.slug === NEW_CATEGORY_SLUG)) {
    console.error(`Category ${NEW_CATEGORY_ID}/${NEW_CATEGORY_SLUG} already exists -- aborting.`)
    process.exit(1)
  }
  const categoryByName = new Map(categories.map((c) => [c.name, c.id]))
  const sourceIds = SOURCE_CATEGORY_NAMES.map((n) => {
    const id = categoryByName.get(n)
    if (!id) throw new Error(`Source category "${n}" not found`)
    return id
  })

  const products = await selectAll((from, to) =>
    supabase.from('products').select('id, sku, name, category_id').eq('is_active', true).range(from, to),
  )
  const scope = products.filter((p) => KEYWORDS.test(p.name) && sourceIds.includes(p.category_id))

  console.log(`\nWould create category ${NEW_CATEGORY_ID} "${NEW_CATEGORY_NAME}" (slug: ${NEW_CATEGORY_SLUG}).`)
  console.log(`${scope.length} products would move into it:`)
  for (const p of scope) console.log(`  ${p.sku} :: ${p.name}`)

  if (!APPLY) {
    console.log('\nDry run only -- no changes made. Re-run with --apply to write these changes.')
    return
  }

  console.log('\nCreating category...')
  const { error: insertCatErr } = await supabase
    .from('categories')
    .insert({ id: NEW_CATEGORY_ID, name: NEW_CATEGORY_NAME, slug: NEW_CATEGORY_SLUG })
  if (insertCatErr) throw new Error(`Failed to create category: ${insertCatErr.message}`)
  await supabase.from('audit_log').insert({
    action: 'category-create',
    entity_type: 'category',
    entity_id: NEW_CATEGORY_ID,
    entity_label: NEW_CATEGORY_NAME,
    old_value: null,
    new_value: NEW_CATEGORY_NAME,
    performed_by: 'admin',
  })

  console.log('Moving products...')
  const categoryById = new Map(categories.map((c) => [c.id, c.name]))
  let applied = 0
  for (const p of scope) {
    const fromCategory = categoryById.get(p.category_id) ?? '(none)'
    const { error } = await supabase.from('products').update({ category_id: NEW_CATEGORY_ID }).eq('sku', p.sku)
    if (error) {
      console.error(`  FAILED ${p.sku}: ${error.message}`)
      continue
    }
    await supabase.from('audit_log').insert({
      action: 'plush-category-split',
      entity_type: 'product',
      entity_id: p.sku,
      entity_label: p.name,
      old_value: fromCategory,
      new_value: NEW_CATEGORY_NAME,
      performed_by: 'admin',
    })
    applied++
  }
  console.log(`\nApplied ${applied}/${scope.length} product moves. Category ${NEW_CATEGORY_ID} "${NEW_CATEGORY_NAME}" created.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
