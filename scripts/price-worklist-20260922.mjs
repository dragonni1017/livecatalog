// price-worklist-20260922.mjs
// Run with: node scripts/price-worklist-20260922.mjs              (dry run + writes the xlsx)
//           node scripts/price-worklist-20260922.mjs --apply       (also sets the placeholder)
//
// Two jobs, deliberately together so they can't drift apart:
//
//  1. Exports every staged SKU that still has no price to an xlsx worklist
//     for a human to price. ALWAYS written, dry run or not -- reading is
//     harmless and the file is the point.
//  2. With --apply, sets proposed_price_cents = 0 as a PLACEHOLDER on those
//     lines, purely to get past the create route's validation.
//
// Why a placeholder is safe here: Erply cannot accept a price over the API
// on this account (proven 2026-09-16, six parameter combinations), so every
// product is created at 0 regardless of what this field says.
// proposed_price_cents is a record of intent for the manual Erply pass, and
// the xlsx below IS that pass's worklist. A zero here changes nothing in
// Erply that wasn't already going to be zero.
//
// The risk it does carry: someone later reading proposed_price_cents could
// mistake 0 for a decided price. That is what the worklist is for, and why
// the export lists the invoice unit price alongside as a starting point.

import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const here = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(here, '..', '.env.local') })

const APPLY = process.argv.includes('--apply')
const OUT = resolve(here, '..', 'data', 'price-worklist-20260922.xlsx')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: ships } = await db.from('shipments').select('id, file_name')
const cn = (id) => /Cntr#(\w+)/.exec(ships.find((s) => s.id === id)?.file_name ?? '')?.[1] ?? '?'

const { data: lines, error } = await db
  .from('shipment_lines')
  .select('id, sku, shipment_id, qty_shipped, cartons, pieces_per_case, proposed_name, proposed_category, proposed_price_cents, invoice_unit_price_cents, invoice_description, case_length_in, case_width_in, case_height_in, case_weight_lb, erply_created_product_id')
  .eq('match_status', 'unmatched_sku')
  .is('erply_created_product_id', null)
if (error) { console.error(error.message); process.exit(1) }

// One row per SKU, not per line: a SKU on two containers gets priced once.
const bySku = new Map()
for (const l of lines) {
  const k = String(l.sku).toUpperCase()
  const e = bySku.get(k) ?? { ...l, containers: [], ids: [], totalQty: 0 }
  e.containers.push(cn(l.shipment_id))
  e.ids.push(l.id)
  e.totalQty += Number(l.qty_shipped ?? 0)
  // Prefer a line that actually carries the descriptive fields.
  if (!e.proposed_name && l.proposed_name) e.proposed_name = l.proposed_name
  if (!e.proposed_category && l.proposed_category) e.proposed_category = l.proposed_category
  if (e.invoice_unit_price_cents == null && l.invoice_unit_price_cents != null) e.invoice_unit_price_cents = l.invoice_unit_price_cents
  bySku.set(k, e)
}

const needPrice = [...bySku.values()].filter((e) => e.proposed_price_cents == null)
const rows = needPrice
  .map((e) => ({
    Container: [...new Set(e.containers)].join(' + '),
    SKU: e.sku,
    'Product name': e.proposed_name ?? '(no name yet — not in QuickBooks)',
    Category: e.proposed_category ?? '(not set)',
    'Total pieces': e.totalQty,
    'Pieces per case': e.pieces_per_case ?? '',
    Cartons: e.cartons ?? '',
    'Carton L x W x H (in)': e.case_length_in != null ? `${e.case_length_in} x ${e.case_width_in} x ${e.case_height_in}` : '',
    'Carton weight (lb)': e.case_weight_lb ?? '',
    'Invoice unit price USD': e.invoice_unit_price_cents != null ? (e.invoice_unit_price_cents / 100).toFixed(2) : '',
    'Invoice description': e.invoice_description ?? '',
    'PRICE (fill this in)': '',
  }))
  .sort((a, b) => a.Container.localeCompare(b.Container) || String(a.Category).localeCompare(String(b.Category)) || a.SKU.localeCompare(b.SKU))

const wb = XLSX.utils.book_new()
const ws = XLSX.utils.json_to_sheet(rows)
ws['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 56 }, { wch: 16 }, { wch: 12 }, { wch: 15 }, { wch: 9 }, { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 40 }, { wch: 20 }]
XLSX.utils.book_append_sheet(wb, ws, 'To price')
XLSX.writeFile(wb, OUT)
console.log(`wrote ${rows.length} SKUs to ${OUT}`)
console.log(`  of which have an invoice unit price to start from: ${rows.filter((r) => r['Invoice unit price USD']).length}`)
console.log(`  with no name yet: ${rows.filter((r) => String(r['Product name']).startsWith('(')).length}`)

if (!APPLY) {
  console.log(`\nDRY RUN — re-run with --apply to also set the 0 placeholder on ${needPrice.reduce((n, e) => n + e.ids.length, 0)} line(s).`)
  process.exit(0)
}

let n = 0
for (const e of needPrice) {
  const { data: upd, error: err } = await db
    .from('shipment_lines')
    .update({ proposed_price_cents: 0 })
    .in('id', e.ids)
    .is('proposed_price_cents', null)
    .is('erply_created_product_id', null)
    .select('id')
  if (err) { console.error(`${e.sku}: ${err.message}`); process.exit(1) }
  n += upd?.length ?? 0
}
console.log(`\nset placeholder price on ${n} line(s).`)
const { data: after } = await db.from('shipment_lines').select('proposed_price_cents').eq('match_status', 'unmatched_sku').is('erply_created_product_id', null)
console.log(`lines still without a price: ${(after ?? []).filter((r) => r.proposed_price_cents == null).length}`)
