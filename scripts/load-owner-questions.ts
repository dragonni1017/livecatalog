// load-owner-questions.ts
// Run with: node scripts/load-owner-questions.ts <owner-sheet.xlsx> <batch>            (dry run)
//           node scripts/load-owner-questions.ts <owner-sheet.xlsx> <batch> --apply
//
// Loads the owner handoff workbook's "QuickBooks fixes", "Pack questions" and
// "Photo proofread (...)" tabs into owner_questions (migration 0073) for
// /admin/owner-questions. Changes nothing else. Answers already typed in the
// sheet come across (QuickBooks rows marked Y come in as done). Re-running is
// safe: (batch, sku, kind) is unique and existing rows are kept, answers too.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const str = (v: unknown) => String(v ?? '').trim()
const [sheetArg, batch] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const APPLY = process.argv.includes('--apply')
if (!sheetArg || !batch) {
  console.error('Usage: node scripts/load-owner-questions.ts <owner-sheet.xlsx> <batch> [--apply]')
  process.exitCode = 1
} else {
  const wb = XLSX.read(fs.readFileSync(path.resolve(sheetArg)))
  const tab = (name: string | RegExp) => {
    const n = wb.SheetNames.find((s) => (typeof name === 'string' ? s === name : name.test(s)))
    return n ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[n], { defval: '' }) : []
  }

  type Q = { sku: string; kind: string; question: string; detail: string; answer: string | null; done: boolean }
  const qs: Q[] = []
  for (const r of tab('QuickBooks fixes')) {
    const to = str(r['Change QuickBooks to (pieces per case)'])
    qs.push({ sku: str(r.SKU), kind: 'QuickBooks fix', question: `Change the QuickBooks case count to ${to} per case, then mark it done.`, detail: str(r['What disagrees']), answer: null, done: /^y/i.test(str(r['Done in QuickBooks? (Y)'])) })
  }
  for (const r of tab('Pack questions')) {
    qs.push({ sku: str(r.SKU), kind: 'Pack question', question: str(r.Question), detail: str(r['What disagrees']), answer: str(r.Answer) || null, done: false })
  }
  for (const r of tab(/^Photo proofread/)) {
    qs.push({ sku: str(r.SKU), kind: str(r.Kind), question: str(r.Question), detail: str(r['What disagrees']), answer: str(r.Answer) || null, done: false })
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  // Case-insensitive SKU match (the sheets and the catalog differ in casing). Paged by id.
  const bySku = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('products').select('id, sku').order('id').range(from, from + 999)
    if (error) throw error
    for (const p of data ?? []) if (p.sku) bySku.set(p.sku.toUpperCase(), p.id)
    if (!data || data.length < 1000) break
  }

  // Every row carries every key (supabase-js sends one column list for the batch).
  const items = qs
    .filter((q) => q.sku && q.kind && q.question)
    .map((q) => ({
      batch,
      product_id: bySku.get(q.sku.toUpperCase()) ?? null,
      sku: q.sku,
      kind: q.kind,
      question: q.question,
      detail: q.detail,
      answer: q.answer,
      status: q.done ? 'done' : q.answer ? 'answered' : 'open',
    }))
  const byKind: Record<string, number> = {}
  for (const i of items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1
  console.log(`${APPLY ? 'APPLYING' : '[DRY RUN]'} batch "${batch}": ${items.length} questions`, byKind)
  const missing = items.filter((i) => !i.product_id).map((i) => i.sku)
  if (missing.length) console.log(`  not in the catalog (kept, but can't be renamed): ${missing.join(', ')}`)
  const pre = items.filter((i) => i.status !== 'open').length
  if (pre) console.log(`  already answered in the sheet: ${pre}`)

  if (APPLY && items.length) {
    const { error } = await db.from('owner_questions').upsert(items, { onConflict: 'batch,sku,kind', ignoreDuplicates: true })
    if (error) throw error
    const { data: check, error: cErr } = await db.from('owner_questions').select('status').eq('batch', batch)
    if (cErr) throw cErr
    console.log(`batch "${batch}" now has ${check.length} questions (${check.filter((c) => c.status === 'open').length} to answer)`)
  }
}
