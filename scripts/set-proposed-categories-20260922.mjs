// set-proposed-categories-20260922.mjs
// Run with: node scripts/set-proposed-categories-20260922.mjs           (dry run)
//           node scripts/set-proposed-categories-20260922.mjs --apply
//
// One-off: writes proposed_category onto the staged lines of the three
// 2026-09-17 containers, from a mapping agreed with Dragon 2026-09-22.
// Draft data on staged shipments only -- nothing reaches Erply, and the
// receiving screen can edit any of it afterwards.
//
// Categories must match an Erply product group name EXACTLY: the create
// route validates every line against getProductGroups() and refuses the
// whole batch otherwise. Names below are taken verbatim from a live pull.

import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') })
const APPLY = process.argv.includes('--apply')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const RIBBONS = ['FD500001','FD500026','FD500036','FD400004-25YARD','FD400011-25YARD','FD400014-25YARD',
  'FD400026-25YARD','FD400032-25YARD','FD400033-25YARD','FD400038-25YARD','FD400039-25YARD','FD400040-25YARD',
  'FD400049-25YARD','FD400059-25YARD','FD400075-25YARD','FD400087-25YARD','FD400104-25YARD','FD400105-25YARD',
  'FD400141-25YARD','FD400151-25YARD']
// "Floral Paper"/"Glossy Floral Paper" -- paper, not flowers. Dragon
// confirmed Floral Papers over the keyword rule's Flowers, 2026-09-22.
const FLORAL_PAPERS = ['F288116','F288155','F288117','F288132','F288136','F288137','F288138','F288139',
  'F288140','F288141','F288142','F288143','F288144','F288145']
const PLUSH = ['P273813-45cm','P273814-60cm','P273814-45cm','P273839-60cm','P273863-110cm','P273863-90cm']
const KEYCHAINS = ['K229581','K229553','K229554','K229582']
const FLOWERS = ['F288094','F288096','F288097','F288098','F288099','F287760']
const SEASONAL = ['D701137','D701138','D701139','F288053']

const MAP = new Map()
const put = (skus, cat) => { for (const s of skus) MAP.set(s.toUpperCase(), cat) }
put(RIBBONS, 'Ribbons')
put(FLORAL_PAPERS, 'Floral Papers')
put(PLUSH, 'Plush Toys')
put(KEYCHAINS, 'Keychains')
put(FLOWERS, 'Flowers')
put(SEASONAL, 'Seasonal Items')
put(['S121037'], 'Squishy / Slime')
put(['B325123'], 'Bags/Purses')

// Deliberately NOT set -- awaiting Dragon's call:
//   D701142 (LED?), D701141 (Deco/Seasonal?), D701140 (Seasonal?),
//   K229580 (Keychains or Seasonal?), F288146 / F288147 (Accessories?),
//   F288106 (Wrapping Paper / Papers?)
// and the four with no name yet: F287759, S162786, CM072601, H424272.

const { data: lines, error } = await db
  .from('shipment_lines')
  .select('id, sku, proposed_category, match_status, erply_created_product_id')
  .eq('match_status', 'unmatched_sku')
  .is('erply_created_product_id', null)
if (error) { console.error(error.message); process.exit(1) }

const todo = []
const skipped = []
for (const l of lines) {
  const cat = MAP.get(String(l.sku).toUpperCase())
  if (!cat) { skipped.push(l.sku); continue }
  if (l.proposed_category) { skipped.push(`${l.sku} (already "${l.proposed_category}")`); continue }
  todo.push({ id: l.id, sku: l.sku, cat })
}
const byCat = {}
for (const t of todo) byCat[t.cat] = (byCat[t.cat] ?? 0) + 1
console.log(`lines to set: ${todo.length}`)
console.log('by category:', JSON.stringify(byCat, null, 2))
console.log(`\nleft blank (${skipped.length}): ${skipped.join(', ')}`)

if (!APPLY) { console.log('\nDRY RUN -- re-run with --apply to write.'); process.exit(0) }

let n = 0
for (const t of todo) {
  const { data, error: e } = await db
    .from('shipment_lines')
    .update({ proposed_category: t.cat })
    .eq('id', t.id)
    .is('proposed_category', null)
    .is('erply_created_product_id', null)
    .select('id')
  if (e) { console.error(`${t.sku}: ${e.message}`); process.exit(1) }
  n += data?.length ?? 0
}
console.log(`\nwrote proposed_category on ${n} line(s).`)
const { data: after } = await db.from('shipment_lines').select('proposed_category').eq('match_status','unmatched_sku')
const still = (after ?? []).filter(r => !r.proposed_category).length
console.log(`lines still without a category: ${still}`)
