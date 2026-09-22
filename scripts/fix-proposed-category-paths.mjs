// fix-proposed-category-paths.mjs
// Run with: node scripts/fix-proposed-category-paths.mjs            (dry run)
//           node scripts/fix-proposed-category-paths.mjs --apply
//
// Rewrites proposed_category from a bare Erply group name to the PATH LABEL
// the app actually uses.
//
// lib/erply.ts getErplyProductGroups() flattens the group tree into
// "Parent / Child" labels, deliberately, so two same-named children under
// different parents stay distinguishable. The create route validates
// proposed_category against THOSE labels. A bare "Keychains" therefore
// fails with 'category "Keychains" is not an Erply product group', even
// though a group by that name plainly exists -- because its label is
// "General Merchandise / Keychains".
//
// scripts/set-proposed-categories-20260922.mjs wrote bare names and
// "validated" them against a flat list of raw g.name values, which is the
// wrong name set and passed everything. 38 of 56 lines would have been
// rejected at create time. Only top-level groups (Seasonal Items, Floral
// Papers) were unaffected.
//
// Targets are resolved against a live getProductGroups() walk using the
// exact same algorithm as lib/erply.ts, and the script refuses to write any
// label that walk does not produce.

import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') })
const APPLY = process.argv.includes('--apply')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Bare name -> intended path label. Written out rather than derived, because
// "Squishy / Slime" is itself a group name containing " / " and no split
// heuristic survives that.
const REWRITE = {
  'Flowers': 'Florals/Gifts / Flowers',
  'Plush Toys': 'Toys / Plush Toys',
  'Ribbons': 'Florals/Gifts / Ribbons',
  'Squishy / Slime': 'Toys / Squishy / Slime',
  'Bags/Purses': 'General Merchandise / Bags/Purses',
  'Keychains': 'General Merchandise / Keychains',
  // Seasonal Items and Floral Papers are top-level: label == name already.
}

const API = `https://${process.env.ERPLY_CLIENT_CODE}.erply.com/api/`
const post = async (p) => (await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ clientCode: process.env.ERPLY_CLIENT_CODE, ...p }) })).json()
const auth = await post({ request: 'verifyUser', username: process.env.ERPLY_USERNAME, password: process.env.ERPLY_PASSWORD })
const sessionKey = auth?.records?.[0]?.sessionKey
if (!sessionKey) { console.error('Erply auth failed'); process.exit(1) }
const groups = await post({ request: 'getProductGroups', sessionKey })

// Mirrors lib/erply.ts getErplyProductGroups() exactly.
const labels = []
const walk = (recs, prefix) => {
  for (const g of recs ?? []) {
    const name = (g.name ?? '').trim()
    if (!g.productGroupID || !name) continue
    const label = prefix ? `${prefix} / ${name}` : name
    labels.push(label)
    walk(g.subGroups, label)
  }
}
walk(groups.records, '')
const known = new Set(labels.map((l) => l.toLowerCase()))
console.log(`erply group labels: ${labels.length}`)

for (const [from, to] of Object.entries(REWRITE)) {
  if (!known.has(to.toLowerCase())) {
    console.error(`REFUSING: target "${to}" is not a label getErplyProductGroups() produces.`)
    process.exit(1)
  }
  console.log(`  "${from}" -> "${to}"  (target verified)`)
}

const { data: lines, error } = await db
  .from('shipment_lines')
  .select('id, sku, proposed_category, erply_created_product_id')
  .eq('match_status', 'unmatched_sku')
  .not('proposed_category', 'is', null)
if (error) { console.error(error.message); process.exit(1) }

const todo = lines.filter((l) => REWRITE[l.proposed_category] && !l.erply_created_product_id)
const alreadyOk = lines.filter((l) => known.has(String(l.proposed_category).toLowerCase()))
console.log(`\nlines to rewrite: ${todo.length}`)
console.log(`lines already valid: ${alreadyOk.length}`)
const other = lines.filter((l) => !REWRITE[l.proposed_category] && !known.has(String(l.proposed_category).toLowerCase()))
if (other.length) console.log(`UNHANDLED (neither valid nor in the rewrite map): ${JSON.stringify(other.map((l) => `${l.sku}:${l.proposed_category}`))}`)

if (!APPLY) { console.log('\nDRY RUN -- re-run with --apply to write.'); process.exit(0) }

let n = 0
for (const l of todo) {
  const { data: upd, error: e } = await db
    .from('shipment_lines')
    .update({ proposed_category: REWRITE[l.proposed_category] })
    .eq('id', l.id)
    .is('erply_created_product_id', null)
    .select('id')
  if (e) { console.error(`${l.sku}: ${e.message}`); process.exit(1) }
  n += upd?.length ?? 0
}
console.log(`\nrewrote ${n} line(s).`)

const { data: after } = await db.from('shipment_lines').select('sku, proposed_category').eq('match_status','unmatched_sku').not('proposed_category','is',null)
const bad = (after ?? []).filter((l) => !known.has(String(l.proposed_category).toLowerCase()))
console.log(`lines whose category would still be rejected: ${bad.length}` + (bad.length ? ` ${JSON.stringify(bad.map(b=>`${b.sku}:${b.proposed_category}`))}` : ''))
