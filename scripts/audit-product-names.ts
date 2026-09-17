// audit-product-names.ts
// Run with: node scripts/audit-product-names.ts
//           node scripts/audit-product-names.ts --csv
//
// Report-only. Checks every catalog name against the house standard in
// lib/product-naming.ts and prints what doesn't comply. Writes nothing —
// see the warning below about where names actually live.
//
// Written in TypeScript and run through Node 24's native type stripping so it
// imports lib/product-naming.ts DIRECTLY. The .mjs scripts in this folder
// can't do that, which is why the parsing rules ended up mirrored in
// scripts/import-packing-list.mjs; don't reintroduce that here.
//
// WHERE NAMES LIVE: products.name is overwritten from Erply on every sync
// (lib/product-sync.ts — `name` is not in skipFields), so fixing a name in
// Supabase alone is undone by the next sync. Any correction this report
// justifies has to be written to Erply via saveProduct.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { auditProductName, type NameIssue } from '../lib/product-naming.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const WRITE_CSV = process.argv.includes('--csv')

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing in .env.local: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// PostgREST caps a plain select at 1000 rows, so page explicitly rather than
// silently auditing the first page and reporting a clean-looking total.
const products: Array<{ sku: string; name: string | null }> = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('products').select('sku, name').range(from, from + 999)
  if (error) throw error
  products.push(...data)
  if (data.length < 1000) break
}

const ISSUE_LABEL: Record<NameIssue, string> = {
  missing_pack_spec: 'no pack spec (cannot be auto-fixed — the counts are not in the name)',
  case_total_mismatch: 'cs.N fits NEITHER convention (neither pk x bx nor bx)',
  all_caps: 'ALL CAPS',
  leading_sku_digits: 'legacy "1234 - " prefix',
  invoice_material_tail: 'supplier "100% material" tail',
  untidy_whitespace: 'stray or doubled whitespace',
}

const counts = new Map<NameIssue, number>()
const conventions = new Map<string, number>()
const rows: Array<{ sku: string; name: string; convention: string; issues: string; suggestion: string }> = []

for (const p of products) {
  const name = p.name ?? ''
  const audit = auditProductName(name)
  if (audit.convention) conventions.set(audit.convention, (conventions.get(audit.convention) ?? 0) + 1)
  if (audit.issues.length === 0) continue
  for (const issue of audit.issues) counts.set(issue, (counts.get(issue) ?? 0) + 1)
  rows.push({
    sku: p.sku,
    name,
    convention: audit.convention ?? '',
    issues: audit.issues.join('|'),
    suggestion: audit.suggestion ?? '',
  })
}

console.log(`Audited ${products.length} product names against the house standard.\n`)
console.log(`Compliant:     ${products.length - rows.length}`)
console.log(`Non-compliant: ${rows.length}\n`)

// Both conventions are valid, so the split is information rather than a
// problem list — see lib/product-naming.ts.
console.log('Pack-spec convention in use:')
console.log(`  ${String(conventions.get('piece') ?? 0).padStart(5)}  piece-sold (cs.N = pieces per case, cs = pk x bx)`)
console.log(`  ${String(conventions.get('pack') ?? 0).padStart(5)}  pack-sold  (cs.N = packs per case, cs = bx)`)
console.log(`  ${String(conventions.get('either') ?? 0).padStart(5)}  either     (pk = 1, so the two agree)`)
console.log(`  ${String(conventions.get('inconsistent') ?? 0).padStart(5)}  NEITHER    <- the real defects\n`)

for (const [issue, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${ISSUE_LABEL[issue]}`)
}

const fixable = rows.filter((r) => r.suggestion)
console.log(`\nMechanically fixable (a suggestion is available): ${fixable.length}`)
console.log('Examples:')
for (const r of fixable.slice(0, 10)) {
  console.log(`  ${r.sku}`)
  console.log(`    now: ${r.name}`)
  console.log(`    ->   ${r.suggestion}`)
}

if (WRITE_CSV) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const out = ['sku,name,convention,issues,suggestion', ...rows.map((r) => [r.sku, esc(r.name), r.convention, r.issues, esc(r.suggestion)].join(','))]
  const dest = path.join(ROOT, 'data', 'product-name-audit.csv')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, out.join('\n') + '\n')
  console.log(`\nFull list written to ${dest}`)
}

console.log('\nNothing was changed. Names are synced from Erply, so corrections must be made there.')
