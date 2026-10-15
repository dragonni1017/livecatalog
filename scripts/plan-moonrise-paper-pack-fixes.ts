// plan-moonrise-paper-pack-fixes.ts
// Run with: node scripts/plan-moonrise-paper-pack-fixes.ts
//
// Writes data/product-name-fixes-plan-moonrise-paper.csv (sku,expect,to,why)
// for scripts/fix-product-names.ts --plan=... to dry-run and apply. Reads
// live names from Supabase and writes nothing anywhere else.
//
// The 10 Moonrise Floral Papers (F287948-F287957) have no pack spec; two
// carry a stray "-- 20/pk" / "- 20/pk" instead. The supplier's 2026-04 ETD
// 0417 1078ctn Original List states it outright for all 10: bx = 20 sheets,
// bx/cs = 60, pk/cs = 60 -- the same 20 sheets/pack, 60 packs/case, pack-sold
// rule as the 22 floral papers fixed 2026-10-13
// (plan-floral-paper-pack-fixes.ts). So the spec becomes "20/pk 60bx/cs cs.60".
// Found by the 2026-10-15 pack-size search (Documents/livecatalog/
// pack-size-findings.xlsx), which matched every one to 5 source files.
//
// The all-caps colour words are title-cased to match how the other Papers
// names read ("Love Flower Paper Pink").

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { parseProductName } from '../lib/product-naming.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })
const dest = path.join(ROOT, 'data', 'product-name-fixes-plan-moonrise-paper.csv')

const SKUS = [
  'F287948', 'F287949', 'F287950', 'F287951', 'F287952',
  'F287953', 'F287954', 'F287955', 'F287956', 'F287957',
]
const SPEC = '20/pk 60bx/cs cs.60'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data, error } = await db.from('products').select('sku, name').in('sku', SKUS).order('sku')
if (error) throw error

const titleCase = (w: string) => (/^[A-Z]{2,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w)

const plan: Array<{ sku: string; expect: string; to: string; why: string }> = []
for (const { sku, name } of data) {
  const base = parseProductName(name).base
    .replace(/\s*-+\s*20\s*\/\s*pk\s*$/i, '') // stray "-- 20/pk" / "- 20/pk"
    .split(' ').map(titleCase).join(' ')
    .trim()
  const to = `${base} - ${SPEC}`
  if (to === name) { console.log(`SKIPPED ${sku}: already ${SPEC}`); continue }
  plan.push({ sku, expect: name, to, why: 'Moonrise floral paper: supplier list 20/bx, 60bx/cs (2026-04 ETD 0417 1078ctn), pack-sold' })
}
const missing = SKUS.filter((s) => !data.some((r) => r.sku === s))
for (const s of missing) console.log(`MISSING ${s}: not in the catalog`)

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
fs.writeFileSync(dest, ['sku,expect,to,why', ...plan.map((p) => [p.sku, p.expect, p.to, p.why].map(esc).join(','))].join('\n') + '\n')
for (const p of plan) console.log(`${p.sku.padEnd(10)} ${p.expect}\n${''.padEnd(10)} -> ${p.to}`)
console.log(`\n${plan.length} planned -> ${dest}`)
