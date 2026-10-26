// plan-pack-spec-name-fixes.ts
// Run with: node scripts/plan-pack-spec-name-fixes.ts
//
// READ-ONLY. For every catalog name the naming audit flags (the Cleanup tab's
// "Name not to standard"), proposes a fix where one can be justified, and
// writes two local files (data/ is never committed):
//
//   data/product-name-fixes-plan-packspec.csv     sku,expect,to,why
//       Proposals only, in the format scripts/fix-product-names.ts --plan reads.
//       Review it, delete any row you disagree with, then dry-run:
//         node scripts/fix-product-names.ts --plan=data/product-name-fixes-plan-packspec.csv
//   data/product-name-fixes-review-packspec.csv
//       Every flagged name: proposal or "needs a person", the rule, the
//       QuickBooks text, and why. The needs-a-person rows are the counting list.
//
// What gets proposed, and why nothing else does: lib/pack-spec-plan.ts. In
// short, a missing pack spec is filled only from QuickBooks figures that state
// it, or by a pack rule Dragon approved (plush, T6422xx tumblers, K229492-560
// keychains). Cosmetic fixes (the audit's own suggestion) are included as-is.
//
// Names live in Erply (the sync overwrites products.name from it), so applying
// goes through fix-product-names.ts, which writes Erply, WooCommerce and
// Supabase with a guard per system. This script writes none of them.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { auditProductName } from '../lib/product-naming.ts'
import { planPackSpecName } from '../lib/pack-spec-plan.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing in .env.local: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const db = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data as T[]))
    if (data.length < 1000) break
  }
  return out
}

type Product = { sku: string; name: string | null; is_active: boolean; manually_hidden: boolean }
type QbItem = { sku_norm: string | null; full_name: string | null; sales_desc: string | null }

const products = await selectAll<Product>('products', 'sku, name, is_active, manually_hidden')
const qb = await selectAll<QbItem>('qb_item_directory', 'sku_norm, full_name, sales_desc')
const qbBySku = new Map(qb.filter((q) => q.sku_norm).map((q) => [q.sku_norm!.toUpperCase(), q]))

interface Row { sku: string; status: string; rule: string; live: string; current: string; proposed: string; qbDesc: string; why: string }
const rows: Row[] = []

for (const p of products) {
  if (!p.is_active) continue
  const name = p.name ?? ''
  const audit = auditProductName(name)
  if (audit.issues.length === 0) continue
  const live = p.manually_hidden ? 'hidden' : 'live'
  const q = qbBySku.get(p.sku.trim().toUpperCase())

  if (audit.suggestion) {
    rows.push({ sku: p.sku, status: 'propose', rule: 'cosmetic', live, current: name, proposed: audit.suggestion, qbDesc: q?.sales_desc ?? '', why: `cosmetic only: ${audit.issues.join(', ')}` })
    continue
  }
  if (!audit.issues.includes('missing_pack_spec')) {
    rows.push({ sku: p.sku, status: 'needs_person', rule: '', live, current: name, proposed: '', qbDesc: q?.sales_desc ?? '', why: `audit: ${audit.issues.join(', ')}` })
    continue
  }
  const plan = planPackSpecName({ sku: p.sku, name, qbDesc: q?.sales_desc ?? null, qbFullName: q?.full_name ?? null })
  rows.push({ sku: p.sku, status: plan.status, rule: plan.rule ?? '', live, current: name, proposed: plan.to ?? '', qbDesc: q?.sales_desc ?? '', why: plan.why })
}

rows.sort((a, b) => a.status.localeCompare(b.status) || a.rule.localeCompare(b.rule) || a.sku.localeCompare(b.sku))

const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const dataDir = path.join(ROOT, 'data')
fs.mkdirSync(dataDir, { recursive: true })
const planPath = path.join(dataDir, 'product-name-fixes-plan-packspec.csv')
const reviewPath = path.join(dataDir, 'product-name-fixes-review-packspec.csv')
const proposals = rows.filter((r) => r.status === 'propose')
fs.writeFileSync(planPath, ['sku,expect,to,why', ...proposals.map((r) => [r.sku, r.current, r.proposed, `${r.rule}: ${r.why}`].map(esc).join(','))].join('\n') + '\n')
fs.writeFileSync(reviewPath, ['sku,status,rule,live,current,proposed,qb_desc,why', ...rows.map((r) => [r.sku, r.status, r.rule, r.live, r.current, r.proposed, r.qbDesc, r.why].map(esc).join(','))].join('\n') + '\n')

const count = (f: (r: Row) => boolean) => rows.filter(f).length
console.log(`${rows.length} active names fail the naming audit.\n`)
console.log(`Proposed: ${proposals.length}`)
for (const rule of ['cosmetic', 'qb-stated', 'qb-derived', 'plush-1pk', 'tumbler-1pk', 'keychain-12pk']) {
  const n = count((r) => r.status === 'propose' && r.rule === rule)
  if (n) console.log(`  ${String(n).padStart(4)}  ${rule}${rule === 'qb-derived' ? '  (marked VERIFY: assumes QuickBooks /cs counts pieces)' : ''}`)
}
console.log(`Needs a person: ${count((r) => r.status === 'needs_person')}`)
const reasons = new Map<string, number>()
for (const r of rows.filter((x) => x.status === 'needs_person')) {
  const key = r.why.replace(/\d+\/cs/g, 'N/cs').replace(/\(.*\)/, '').replace(/".*"/, '"…"').trim()
  reasons.set(key, (reasons.get(key) ?? 0) + 1)
}
for (const [why, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${why}`)
console.log(`\nExamples:`)
for (const r of proposals.slice(0, 12)) console.log(`  ${r.sku.padEnd(16)} ${r.current}\n  ${''.padEnd(16)} -> ${r.proposed}   [${r.rule}]`)
console.log(`\nWrote ${path.relative(ROOT, planPath)} (${proposals.length} proposals)`)
console.log(`Wrote ${path.relative(ROOT, reviewPath)} (all ${rows.length} rows)`)
console.log('Nothing was changed anywhere.')
