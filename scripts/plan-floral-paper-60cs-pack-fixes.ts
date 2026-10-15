// plan-floral-paper-60cs-pack-fixes.ts
// Run with: node scripts/plan-floral-paper-60cs-pack-fixes.ts
//
// Writes data/product-name-fixes-plan-floral-paper-60cs.csv (sku,expect,to,why)
// for scripts/fix-product-names.ts --plan=... to dry-run and apply. Reads
// live names from Supabase and writes nothing anywhere else.
//
// 26 floral / wrapping papers had no pack spec. Supplier shipping documents
// (2026-10-15 pack-size search, Documents/livecatalog/pack-size-findings.xlsx)
// put every one at 60 per carton, 2+ source files each, but carry no
// per-pack column; 7 say 20张/包 (20 sheets/pack) in 品名. Dragon confirmed
// 2026-10-15 that they follow the floral-paper rule already applied to the 22
// papers on 2026-10-13 and the 10 Moonrise papers: 20 sheets/pack, 60
// packs/case, pack-sold. So the spec becomes "20/pk 60bx/cs cs.60".
//
// Bases are kept as written (QB typos like "Lavedar" left, as on 2026-10-13).
// Not included: F288016 White Flower Basket, P273854 plush and T642285 fan,
// which also ship 60/carton but aren't paper.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { parseProductName } from '../lib/product-naming.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })
const dest = path.join(ROOT, 'data', 'product-name-fixes-plan-floral-paper-60cs.csv')

const SKUS = [
  'F287826', 'F287904', 'F287906', 'F287907', 'F287908', 'F287922', 'F287924',
  'F287974', 'F287975', 'F287976', 'F287977', 'F287979', 'F287981', 'F287983',
  'F287984', 'F287985', 'F287986', 'F287987', 'F287988', 'F287989', 'F287990',
  'F287991', 'F288011', 'F288013', 'F288014', 'F288015',
]
const SPEC = '20/pk 60bx/cs cs.60'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data, error } = await db.from('products').select('sku, name').in('sku', SKUS).order('sku')
if (error) throw error

const plan: Array<{ sku: string; expect: string; to: string; why: string }> = []
for (const { sku, name } of data) {
  const parsed = parseProductName(name)
  const to = `${parsed.base.trim()} - ${SPEC}`
  if (to === name) { console.log(`SKIPPED ${sku}: already ${SPEC}`); continue }
  plan.push({ sku, expect: name, to, why: 'floral paper: supplier 60/cs, 20 sheets/pack (confirmed rule), pack-sold' })
}
const missing = SKUS.filter((s) => !data.some((r) => r.sku === s))
for (const s of missing) console.log(`MISSING ${s}: not in the catalog`)

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
fs.writeFileSync(dest, ['sku,expect,to,why', ...plan.map((p) => [p.sku, p.expect, p.to, p.why].map(esc).join(','))].join('\n') + '\n')
for (const p of plan) console.log(`${p.sku.padEnd(10)} ${p.expect}\n${''.padEnd(10)} -> ${p.to}`)
console.log(`\n${plan.length} planned -> ${dest}`)
