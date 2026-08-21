// check-erply-category-alignment-20260821.mjs
// Read-only re-verification: fetches every active Erply product's groupName,
// runs it through resolveErplyCategoryAlias(), and diffs the resulting set
// against Supabase's current category names -- to catch any Erply group
// that's new since the 2026-08-18 alias map / 2026-08-19 manual corrections
// and would need a new alias entry.
//
// Run with: npx tsx scripts/check-erply-category-alignment-20260821.mjs
// Requires ERPLY_CLIENT_CODE/ERPLY_USERNAME/ERPLY_PASSWORD in .env.local.

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const { getErplyProducts } = await import('../lib/erply.ts')
const { resolveErplyCategoryAlias } = await import('../lib/erply-category-aliases.ts')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

console.log('Fetching all Erply products...')
const erplyProducts = await getErplyProducts()
console.log(`Fetched ${erplyProducts.length} Erply products.`)

const { data: categories } = await supabase.from('categories').select('name')
const supabaseCategoryNames = new Set((categories ?? []).map((c) => c.name))

const groupCounts = new Map()
for (const p of erplyProducts) {
  // getErplyProducts() already normalizes Erply's raw groupName into
  // categoryName (see normalizeProduct in lib/erply.ts) -- that's the field
  // that actually exists on the returned ErplySyncProduct objects.
  const raw = p.categoryName ?? ''
  if (!raw) continue
  groupCounts.set(raw, (groupCounts.get(raw) ?? 0) + 1)
}

const unmapped = []
for (const [groupName, count] of groupCounts) {
  const resolved = resolveErplyCategoryAlias(groupName)
  if (!supabaseCategoryNames.has(resolved)) {
    unmapped.push({ groupName, resolved, count })
  }
}

console.log(`\n${groupCounts.size} distinct Erply groupNames in use.`)
console.log(`${supabaseCategoryNames.size} Supabase categories.`)

if (unmapped.length === 0) {
  console.log('\nAll Erply groups (via alias map) resolve to an existing Supabase category. No drift found.')
} else {
  console.log(`\n${unmapped.length} Erply group(s) resolve to a category NOT currently in Supabase:`)
  for (const u of unmapped.sort((a, b) => b.count - a.count)) {
    console.log(`  "${u.groupName}" -> "${u.resolved}" (${u.count} products)`)
  }
}
