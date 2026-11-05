// push-catalog-descriptions-to-woo.ts
// Run with: node scripts/push-catalog-descriptions-to-woo.ts                     (dry run, scope=empty)
//           node scripts/push-catalog-descriptions-to-woo.ts --apply
//           node scripts/push-catalog-descriptions-to-woo.ts --scope=replace      (dry run of replacing different text)
//           node scripts/push-catalog-descriptions-to-woo.ts --undo=<backup.csv>  (put the old text back)
//
// Copies the catalog's written product descriptions to WooCommerce
// (ly-usa.com) as the product's long description. Photos are already in
// sync (scripts/push-catalog-wide-image-gap-to-woo.mjs finds 0 to push); the
// gap is descriptions: 1,165 catalog descriptions are real copy, and on
// 2026-11-05 WooCommerce had nothing for 180 of them and only the name/pack
// spec or a warehouse note for 985.
//
// Scopes:
//   empty    (default) only products whose WooCommerce description AND short
//            description are both empty. Nothing on WooCommerce is replaced.
//   replace  products whose WooCommerce text differs from the catalog's.
//            Replaces existing text, so only after the WooCommerce team agrees.
//
// "Real" description = lib/product-description.ts isNameCopyDescription is
// false (the same rule the storefront uses to hide name copies). Only active
// catalog products matched by SKU (case-insensitive) to a published
// WooCommerce product.
//
// --apply, per CLAUDE.md / docs/memory log-prod-data-changes:
//   1. re-fetches each product just before writing and skips any whose
//      WooCommerce text changed since the plan (so "empty" really is empty)
//   2. writes the backup CSV (old description + short description) and an
//      audit_log row per product BEFORE writing
//   3. batch-updates WooCommerce, then re-fetches every product to confirm
//      (batch responses aren't trusted; see project-woo-direct-outofstock-write)
// The WooCommerce site is run by another team; get their OK before --apply.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { isNameCopyDescription } from '../lib/product-description.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')
const SCOPE = (process.argv.find((a) => a.startsWith('--scope='))?.split('=')[1] ?? 'empty') as 'empty' | 'replace'
const UNDO = process.argv.find((a) => a.startsWith('--undo='))?.slice('--undo='.length)
const BATCH = 50
const STAMP = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
const OUT_DIR = path.join(ROOT, 'data', 'woo-description-push')

for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WOO_STORE_URL', 'WOO_CONSUMER_KEY', 'WOO_CONSUMER_SECRET']) {
  if (!process.env[k]) throw new Error(`Missing in .env.local: ${k}`)
}
if (SCOPE !== 'empty' && SCOPE !== 'replace') throw new Error('--scope must be empty or replace')

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const raw = process.env.WOO_STORE_URL!
const WOO = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '')
const AUTH = `Basic ${Buffer.from(`${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`).toString('base64')}`

interface WooProduct { id: number; sku: string; status: string; description: string; short_description: string }

const K = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase()
/** Visible text of WooCommerce HTML, for comparing. */
const text = (html: string) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8243;|&quot;/g, '"').replace(/&#8217;|&#039;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
/** The catalog's plain text as a WooCommerce description (escaped, one paragraph per line). */
const toHtml = (s: string) =>
  s.trim().split(/\n+/).map((line) => `<p>${line.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('\n')
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const writeCsv = (file: string, header: string[], rows: unknown[][]) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n')
}

async function wooGet(p: string) {
  const res = await fetch(`${WOO}/wp-json/wc/v3${p}`, { headers: { Authorization: AUTH } })
  if (!res.ok) throw new Error(`WooCommerce ${res.status} on ${p}`)
  return res
}
async function wooProduct(id: number): Promise<WooProduct> {
  return (await wooGet(`/products/${id}?_fields=id,sku,status,description,short_description`)).json()
}
async function wooBatch(update: { id: number; description: string }[]) {
  const res = await fetch(`${WOO}/wp-json/wc/v3/products/batch`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ update }),
  })
  if (!res.ok) throw new Error(`batch HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

function parseCsv(file: string): Record<string, string>[] {
  const src = fs.readFileSync(file, 'utf8')
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [h, ...rest] = rows
  return rest.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])))
}

async function undo(file: string) {
  const rows = parseCsv(file)
  console.log(`${APPLY ? 'UNDOING' : '[DRY RUN] would undo'} ${rows.length} products from ${path.relative(ROOT, file)}`)
  if (!APPLY) return
  for (let i = 0; i < rows.length; i += BATCH) {
    await wooBatch(rows.slice(i, i + BATCH).map((r) => ({ id: Number(r.woo_id), description: r.old_description })))
  }
  let ok = 0
  for (const r of rows) if (text((await wooProduct(Number(r.woo_id))).description) === text(r.old_description)) ok++
  await db.from('audit_log').insert(rows.map((r) => ({ action: 'woo_description_restored', entity_type: 'product', entity_id: r.product_id, entity_label: r.sku, old_value: r.new_description, new_value: r.old_description, performed_by: `script push-catalog-descriptions-to-woo --undo ${path.basename(file)}` })))
  console.log(`Restored and confirmed: ${ok}/${rows.length}`)
}

async function main() {
  if (UNDO) return undo(path.resolve(UNDO))

  const cat: { id: string; sku: string; name: string; description: string | null }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('products').select('id, sku, name, description').eq('is_active', true).order('id').range(from, from + 999)
    if (error) throw error
    cat.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const real = cat.filter((p) => p.sku && (p.description ?? '').trim() && !isNameCopyDescription(p.description, p.name))

  const woo: WooProduct[] = []
  for (let page = 1; ; page++) {
    const res = await wooGet(`/products?per_page=100&page=${page}&status=any&_fields=id,sku,status,description,short_description`)
    const batch = (await res.json()) as WooProduct[]
    woo.push(...batch)
    if (page >= Number(res.headers.get('x-wp-totalpages') ?? 1) || batch.length === 0) break
  }
  const wooBy = new Map(woo.filter((w) => K(w.sku)).map((w) => [K(w.sku), w]))

  const plan: { product_id: string; sku: string; woo_id: number; old_description: string; old_short: string; new_description: string }[] = []
  const counts = { realInCatalog: real.length, notOnWoo: 0, notPublished: 0, alreadySame: 0, wooHasOtherText: 0, wooEmpty: 0 }
  for (const p of real) {
    const w = wooBy.get(K(p.sku))
    if (!w) { counts.notOnWoo++; continue }
    if (w.status !== 'publish') { counts.notPublished++; continue }
    const wt = text(w.description) || text(w.short_description)
    const ct = text(toHtml(p.description!))
    if (wt === ct || text(w.description) === ct) { counts.alreadySame++; continue }
    if (wt) counts.wooHasOtherText++
    else counts.wooEmpty++
    if (SCOPE === 'empty' ? !wt : !!wt) {
      plan.push({ product_id: p.id, sku: p.sku, woo_id: w.id, old_description: w.description ?? '', old_short: w.short_description ?? '', new_description: toHtml(p.description!) })
    }
  }

  console.log(`${APPLY ? 'APPLYING' : '[DRY RUN]'} scope=${SCOPE}: ${plan.length} WooCommerce products would get the catalog description`)
  console.log(`  catalog descriptions that are real copy: ${counts.realInCatalog}`)
  console.log(`  WooCommerce empty: ${counts.wooEmpty} | has other text: ${counts.wooHasOtherText} | already the same: ${counts.alreadySame} | not published: ${counts.notPublished} | not on WooCommerce: ${counts.notOnWoo}`)
  const planFile = path.join(OUT_DIR, `plan-${SCOPE}-${STAMP}.csv`)
  writeCsv(planFile, ['product_id', 'sku', 'woo_id', 'old_description', 'old_short', 'new_description'], plan.map((r) => [r.product_id, r.sku, r.woo_id, r.old_description, r.old_short, r.new_description]))
  console.log(`  plan (old and new text for every product): ${path.relative(ROOT, planFile)}`)
  for (const r of plan.slice(0, 5)) console.log(`  e.g. ${r.sku} (woo ${r.woo_id}): ${text(r.old_description) ? `"${text(r.old_description).slice(0, 50)}" -> ` : ''}"${text(r.new_description).slice(0, 90)}"`)
  if (!APPLY || plan.length === 0) {
    if (!APPLY) console.log('\nDry run only: nothing was written to WooCommerce. Pass --apply to write.')
    return
  }

  // 1. Re-check right before writing.
  const go: typeof plan = []
  const changed: string[] = []
  for (const r of plan) {
    const now = await wooProduct(r.woo_id)
    if (now.description === r.old_description && now.short_description === r.old_short) go.push(r)
    else changed.push(r.sku)
  }
  if (changed.length) console.log(`Skipped, changed on WooCommerce since the plan (${changed.length}): ${changed.join(', ')}`)

  // 2. Backup + audit rows before any write. Every audit row carries every key.
  const backup = path.join(OUT_DIR, `backup-${SCOPE}-${STAMP}.csv`)
  writeCsv(backup, ['product_id', 'sku', 'woo_id', 'old_description', 'old_short', 'new_description'], go.map((r) => [r.product_id, r.sku, r.woo_id, r.old_description, r.old_short, r.new_description]))
  console.log(`Backup (for --undo): ${path.relative(ROOT, backup)}`)
  for (let i = 0; i < go.length; i += 500) {
    const { error } = await db.from('audit_log').insert(go.slice(i, i + 500).map((r) => ({
      action: 'woo_description_set',
      entity_type: 'product',
      entity_id: r.product_id,
      entity_label: r.sku,
      old_value: r.old_description,
      new_value: r.new_description,
      performed_by: `script push-catalog-descriptions-to-woo scope=${SCOPE}; written before apply`,
    })))
    if (error) throw error
  }

  // 3. Write, then confirm every one independently.
  let failedBatches = 0
  for (let i = 0; i < go.length; i += BATCH) {
    try {
      await wooBatch(go.slice(i, i + BATCH).map((r) => ({ id: r.woo_id, description: r.new_description })))
    } catch (err) {
      failedBatches++
      console.error(`  batch ${i / BATCH + 1} failed: ${(err as Error).message}`)
    }
  }
  const results: unknown[][] = []
  let ok = 0
  for (const r of go) {
    const now = await wooProduct(r.woo_id)
    const good = text(now.description) === text(r.new_description)
    if (good) ok++
    results.push([r.sku, r.woo_id, good ? 'confirmed' : 'NOT CONFIRMED'])
  }
  const log = path.join(OUT_DIR, `results-${SCOPE}-${STAMP}.csv`)
  writeCsv(log, ['sku', 'woo_id', 'result'], results)
  console.log(`\nConfirmed on WooCommerce: ${ok}/${go.length}${failedBatches ? ` (${failedBatches} batch(es) failed)` : ''}. Log: ${path.relative(ROOT, log)}`)
  console.log(`Undo: node scripts/push-catalog-descriptions-to-woo.ts --undo=${path.relative(ROOT, backup)} --apply`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exitCode = 1
})
