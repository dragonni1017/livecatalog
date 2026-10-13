// plan-floral-paper-pack-fixes.ts
// Run with: node scripts/plan-floral-paper-pack-fixes.ts
//
// Writes data/product-name-fixes-plan-floral-paper.csv (sku,expect,to,why)
// for scripts/fix-product-names.ts --plan=... to dry-run and apply. Reads
// live names from Supabase and writes nothing anywhere else.
//
// The floral papers received 2026-09-23 got the receiving placeholder spec
// "60/pk 1bx/cs cs.60" (the whole QuickBooks case as one pack of 60), or none
// at all. QuickBooks itself says "60pk/cs": 60 PACKS per case. Dragon
// confirmed the floral papers are 20 sheets per pack, 60 packs per case,
// sold by the pack (lib/product-naming.ts, PACK-SOLD), which is how 278 live
// Papers names already read. So the spec becomes "20/pk 60bx/cs cs.60".
// A case is still 60 sellable units, so stock_qty needs no change.
//
// Deliberately NOT included: F288118 Newspaper Bouquet Wrap. Its QuickBooks
// text is "60/cs", not "60pk/cs", and it isn't a floral paper.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { parseProductName } from '../lib/product-naming.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })
const dest = path.join(ROOT, 'data', 'product-name-fixes-plan-floral-paper.csv')

const SKUS = [
  'CM072310', 'F288081', 'F288082', 'F288083', 'F288090', 'F288091', 'F288092', 'F288093',
  'F288116', 'F288117', 'F288132', 'F288136', 'F288137', 'F288138', 'F288139', 'F288140',
  'F288141', 'F288142', 'F288143', 'F288144', 'F288145', 'F288155',
]
const SPEC = '20/pk 60bx/cs cs.60'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data, error } = await db.from('products').select('sku, name').in('sku', SKUS).order('sku')
if (error) throw error

const plan: Array<{ sku: string; expect: string; to: string; why: string }> = []
for (const { sku, name } of data) {
  // A name without a spec still carries QuickBooks' "- 60pk/cs"; drop it,
  // since the spec now states the same 60 packs.
  const base = parseProductName(name).base.replace(/\s*-\s*60\s*pk\s*\/\s*cs\s*$/i, '')
  const to = `${base} - ${SPEC}`
  if (to === name) { console.log(`SKIPPED ${sku}: already ${SPEC}`); continue }
  plan.push({ sku, expect: name, to, why: 'floral paper: QB 60pk/cs, 20 sheets/pack (confirmed rule), pack-sold' })
}
const missing = SKUS.filter((s) => !data.some((r) => r.sku === s))
for (const s of missing) console.log(`MISSING ${s}: not in the catalog`)

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
fs.writeFileSync(dest, ['sku,expect,to,why', ...plan.map((p) => [p.sku, p.expect, p.to, p.why].map(esc).join(','))].join('\n') + '\n')
for (const p of plan) console.log(`${p.sku.padEnd(10)} ${p.expect}\n${''.padEnd(10)} -> ${p.to}`)
console.log(`\n${plan.length} planned -> ${dest}`)
