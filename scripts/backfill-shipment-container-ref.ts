// backfill-shipment-container-ref.ts
// Run with: node scripts/backfill-shipment-container-ref.ts            (dry run)
//           node scripts/backfill-shipment-container-ref.ts --apply
//
// Fills shipments.container_ref from the file name for rows staged before the
// staging route started deriving it.
//
// The column has existed since migration 0048 and the API always accepted it,
// but the only thing that set it was an optional text box nobody typed into --
// so all 9 shipments had it null while every file name carried "Cntr#XXXX".
// Two things depend on it: the duplicate-container guard in
// app/admin/api/shipments/apply/route.ts has nothing to match on without it,
// and the audit log falls back to the raw file name.
//
// Uses the same containerRefFromFileName the route uses, so a file name this
// script resolves is one the route would resolve identically.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { containerRefFromFileName } from '../lib/receiving.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const { data: shipments, error } = await db
  .from('shipments')
  .select('id, file_name, container_ref, status, staged_at')
  .order('staged_at')
if (error) { console.error(error.message); process.exit(1) }

const plan: { id: string; ref: string; file: string; status: string }[] = []
const unresolved: string[] = []
for (const s of shipments ?? []) {
  if (s.container_ref) continue
  const ref = containerRefFromFileName(s.file_name)
  if (!ref) { unresolved.push(s.file_name); continue }
  plan.push({ id: s.id, ref, file: s.file_name, status: s.status })
}

console.log(`${(shipments ?? []).length} shipment(s); ${(shipments ?? []).filter((s) => s.container_ref).length} already have a container_ref`)
console.log(`${plan.length} to fill${APPLY ? '' : '  (dry run - nothing written)'}\n`)
for (const p of plan) console.log(`  ${p.ref.padEnd(14)} ${p.status.padEnd(10)} ${p.file.slice(0, 60)}`)
if (unresolved.length) {
  console.log(`\nNo container in the file name (left null, nothing guessed):`)
  unresolved.forEach((f) => console.log(`  ${f}`))
}

// A container appearing on more than one shipment is exactly what the guard
// exists to catch, so surface it here rather than leaving it to be discovered
// at apply time.
const byRef = new Map<string, string[]>()
for (const p of plan) byRef.set(p.ref, [...(byRef.get(p.ref) ?? []), p.status])
const shared = [...byRef.entries()].filter(([, v]) => v.length > 1)
if (shared.length) {
  console.log(`\nContainers on more than one shipment (the guard will flag these):`)
  shared.forEach(([ref, statuses]) => console.log(`  ${ref}: ${statuses.join(', ')}`))
}

if (!APPLY || plan.length === 0) {
  if (!APPLY && plan.length > 0) console.log('\nRe-run with --apply to write.')
  process.exit(0)
}

let done = 0
for (const p of plan) {
  const { error: err } = await db.from('shipments').update({ container_ref: p.ref }).eq('id', p.id)
  if (err) console.error(`  FAILED ${p.ref}: ${err.message}`)
  else done++
}
const { data: after } = await db.from('shipments').select('container_ref')
console.log(`\nUpdated ${done}/${plan.length}. Shipments with a container_ref now: ${(after ?? []).filter((s) => s.container_ref).length}/${(after ?? []).length}`)
