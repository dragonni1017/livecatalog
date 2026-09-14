// seed-bins-from-erply.mjs
// Run with: node scripts/seed-bins-from-erply.mjs           (dry run)
//           node scripts/seed-bins-from-erply.mjs --apply   (writes Supabase)
//
// Mirrors Erply's bins into the `bins` table from migration 0046, so bin
// dimensions and weight limits can be recorded against them. Erply owns which
// bins exist; this repo owns how big they are, because Erply's bin record has
// no dimension or weight-limit field at all (see 0046's header).
//
// Writes to Supabase ONLY. Nothing is sent to Erply -- every Erply call here
// is getBins.
//
// Idempotent: matches on Erply's binID first, then on code, and only writes
// rows that are new or whose code/status/warehouse actually changed. Bins that
// have since disappeared from Erply are reported, not deleted -- a bin row may
// already carry a hand-measured type assignment, and deleting it would throw
// that away on a transient API hiccup.
//
// Meant to run locally: Erply's API domain isn't allowlisted in a sandbox.

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')

const {
  ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
} = process.env

const missingEnv = Object.entries({
  ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
}).filter(([, v]) => !v).map(([k]) => k)
if (missingEnv.length > 0) {
  console.error(`Missing in .env.local: ${missingEnv.join(', ')}`)
  process.exit(1)
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(`https://${ERPLY_CLIENT_CODE}.erply.com/api/`, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function fetchErplyBins() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey
  const all = []
  for (let pageNo = 1; ; pageNo++) {
    const d = await erplyPost({ request: 'getBins', sessionKey, recordsOnPage: '100', pageNo: String(pageNo) })
    const recs = d.records ?? []
    all.push(...recs)
    if (recs.length === 0 || all.length >= (d.status?.recordsTotal ?? 0)) break
  }
  return all
}

async function fetchExistingBins() {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('bins')
      .select('id, code, erply_bin_id, erply_warehouse_id, status, bin_type_id')
      // Ordered by a unique column: range() pagination over a non-unique sort
      // silently duplicates and drops rows (see the note in
      // app/admin/measurements/page.tsx).
      .order('code', { ascending: true })
      .range(from, from + 999)
    if (error) {
      // PostgREST's wording for a missing table is "Could not find the table
      // 'public.bins' in the schema cache" -- not the raw Postgres "relation
      // does not exist", which an earlier version of this check expected and
      // so missed entirely.
      if (/could not find the table|does not exist/i.test(error.message)) {
        console.error('No `bins` table -- apply supabase/migrations/0046_bin_capacity.sql first.')
        return null
      }
      throw new Error(error.message)
    }
    all.push(...data)
    if (data.length < 1000) break
  }
  return all
}

async function main() {
  const existing = await fetchExistingBins()
  if (existing === null) { process.exitCode = 1; return }

  const erplyBins = await fetchErplyBins()
  console.log(`Erply: ${erplyBins.length} bins. Supabase: ${existing.length} rows.`)

  const byErplyId = new Map(existing.filter((b) => b.erply_bin_id != null).map((b) => [b.erply_bin_id, b]))
  const byCode = new Map(existing.map((b) => [b.code, b]))

  const inserts = []
  const updates = []
  let unchanged = 0

  for (const bin of erplyBins) {
    const code = String(bin.code ?? '').trim()
    if (!code) continue
    const next = {
      code,
      erply_bin_id: Number(bin.binID),
      erply_warehouse_id: Number(bin.warehouseID),
      // Erply sends 'ACTIVE' / 'ARCHIVED'; anything else would trip 0046's
      // check constraint, so it's normalised rather than passed through.
      status: String(bin.status).toUpperCase() === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    }

    // binID first: a bin can be renamed in Erply, and matching on code alone
    // would then insert a duplicate and orphan the row carrying the type
    // assignment.
    const row = byErplyId.get(next.erply_bin_id) ?? byCode.get(code)
    if (!row) { inserts.push(next); continue }

    const changed = ['code', 'erply_bin_id', 'erply_warehouse_id', 'status']
      .filter((f) => String(row[f] ?? '') !== String(next[f] ?? ''))
    if (changed.length === 0) { unchanged++; continue }
    updates.push({ id: row.id, ...next, changed })
  }

  const erplyIds = new Set(erplyBins.map((b) => Number(b.binID)))
  const goneFromErply = existing.filter((b) => b.erply_bin_id != null && !erplyIds.has(b.erply_bin_id))

  console.table([
    { outcome: 'to insert', count: inserts.length },
    { outcome: 'to update', count: updates.length },
    { outcome: 'unchanged', count: unchanged },
    { outcome: 'in Supabase but gone from Erply (left alone)', count: goneFromErply.length },
  ])
  if (updates.length > 0) {
    console.log('\nchanges:')
    console.table(updates.slice(0, 10).map((u) => ({ code: u.code, changed: u.changed.join(', ') })))
  }
  if (goneFromErply.length > 0) {
    console.log(`\nNot deleted -- these may already carry a bin type: ${goneFromErply.map((b) => b.code).slice(0, 20).join(', ')}`)
  }

  const typed = existing.filter((b) => b.bin_type_id != null).length
  console.log(`\n${typed} of ${existing.length} existing bins have a type (i.e. known capacity).`)

  if (inserts.length === 0 && updates.length === 0) {
    console.log('Nothing to write.')
    return
  }
  if (!APPLY) {
    console.log(`\nDry run -- nothing written. Re-run with --apply to write ${inserts.length} inserts and ${updates.length} updates.`)
    return
  }

  let written = 0
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase.from('bins').insert(inserts.slice(i, i + 500))
    if (error) {
      console.error(`Insert batch at ${i} failed: ${error.message}`)
      process.exitCode = 1
      return
    }
    written += Math.min(500, inserts.length - i)
    console.log(`  inserted ${written} / ${inserts.length}`)
  }

  // Per-row UPDATE rather than a batched upsert: `code` is NOT NULL, and an
  // id-only upsert payload fails that check before ON CONFLICT resolution
  // runs. Same trap as backfill-product-measurements.mjs.
  let updated = 0
  for (const u of updates) {
    const { id, changed, ...fields } = u
    const { error } = await supabase
      .from('bins')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      console.error(`Update of ${fields.code} failed: ${error.message}`)
      process.exitCode = 1
      return
    }
    updated++
  }
  console.log(`Done: ${written} inserted, ${updated} updated.`)
}

await main()
