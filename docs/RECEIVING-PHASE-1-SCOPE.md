# Receiving (shipments → stock) — Phase 1 scope

Agreed 2026-09-16. Phase 1 = upload a supplier packing list in the admin,
correct the received counts, apply it once. Stock is written to **Erply**;
Supabase picks it up on the next stock sync.

## Why it looks like this

Three existing facts in this repo shape the whole design:

1. **Stock is authoritative in Erply, not Supabase.** `products.stock_qty` is
   excluded from the normal Erply→Supabase sync (`skipFields` in
   `app/api/sync/route.ts`) and `syncStockFromErply()` uses the anchored-delta
   design from migration 0042 so an order-fulfillment decrement survives a
   sync. Erply only exposes a delta API, `saveInventoryRegistration`. Nothing
   here may write `stock_qty` directly — it would fight the decrement and be
   overwritten anyway.
2. **The xlsx upload shape already exists.** `components/admin/ExcelDropzone.tsx`
   parses the workbook **client-side** (`XLSX.read` in the browser) and POSTs
   rows as JSON; `/api/import/diff` previews, `/api/import` applies,
   `import_runs` logs history. Receiving mirrors that — no new upload
   machinery.
3. **A packing list is not a receipt.** It records what the supplier shipped.
   What arrived can differ (short shipment, damage), so the counts must be
   editable before apply.

## Data model — migration 0048

`shipments`: `id`, `file_name`, `file_hash` (UNIQUE — the idempotency key),
`container_ref`, `line_count`, `status` (`staged`/`applied`/`abandoned`),
`staged_by`, `staged_at`, `applied_by`, `applied_at`, `notes`.

`shipment_lines`: `id`, `shipment_id` FK, `sku`, `barcode_from_file`,
`qty_shipped`, `qty_received` (editable, defaults to shipped), `match_status`
(`matched`/`unmatched_sku`/`barcode_mismatch`), carton dims + weight from the
sheet, `erply_registration_id`, `applied_at`, `apply_error`.

`applied_at` lives on the **line**, not just the shipment, so a partial
failure mid-batch is recoverable without re-adding what already landed —
the same one-way-fact pattern as `entered_in_qb` and `stock_decremented_at`.

Both tables need explicit grants in the migration (CLAUDE.md: admin-only is
not an exemption — without grants every query returns PGRST205), granted by
looping over `pg_roles` rather than naming roles, since a multi-role grant
fails all-or-nothing and the Supabase editor's single transaction would roll
back the `create table` above it.

## Files

| File | Change |
|---|---|
| `lib/packing-list.ts` | NEW — header matching, unit-from-header, SKU/UPC/QTY resolution, ported from `scripts/import-packing-list.mjs` |
| `lib/erply.ts` | NEW helper `saveInventoryRegistration()`, 50/batch, ported from `scripts/add-stock-from-packing-list.mjs` |
| `app/admin/api/shipments/route.ts` | NEW — POST stages parsed rows, PATCH edits counts / abandons, GET lists |
| `app/admin/api/shipments/apply/route.ts` | NEW — the one-way action: Erply write, independent re-fetch verify, per-line write-back |
| `app/admin/receiving/page.tsx` + `ReceivingUpload.tsx` | NEW — dropzone → preview table → confirm → result |
| `app/admin/page.tsx` | Tile + staged-shipment badge |

## Guards

- **Idempotency** — unique `file_hash`; re-uploading the same file opens the
  existing shipment instead of creating a second one.
- **Stale-shipment gate** — apply once, and only after an explicit "this has
  not been received yet" confirmation; refuses by default. This is the
  EMCU8402359 lesson: that container is from 2023, every SKU reads 0 stock,
  and applying it would inject phantom inventory into live stock.
- **UPC cross-check** — a barcode mismatch marks the line and excludes it from
  apply, given this business's real barcode-collision history.
- **Unmatched SKUs** — staged and visible, never applied (Phase 2).

## Decisions taken (defaults, not answers)

- **Stock only.** Carton dimensions from the sheet are *stored* on
  `shipment_lines` but not written to `products` in Phase 1. The existing
  dimensions importer already covers that and is safe to run on a file of any
  age. Writing them during receiving is a follow-up toggle.
- **Warehouse 1** is the receiving warehouse, matching `getErplyStock`'s
  existing default.
- **`scripts/import-packing-list.mjs` is kept**, not deleted, as a documented
  mirror of `lib/packing-list.ts` — a `.mjs` cannot import TypeScript, and the
  script is proven against real data. Same tolerance as
  `implausibleCaseMeasurement`'s four mirrors. Canonical copy is the lib.

## Open blocker

**Erply is configured locally but not in Vercel production.** Staging and
preview work anywhere; the apply step needs `ERPLY_*` env vars in Vercel or it
must be run locally. Settle before relying on apply from a deployed URL.

## Out of scope for Phase 1

New product creation (Phase 2 — the sheets have no English name, category, or
price), bin/put-away assignment, the PDF arrival notices (no SKU column, never
validated), multi-warehouse, scheduled folder watching.

## Verification

Parse-only against container EMCU8402359 first — all 27 lines should match
with zero rejections, proving the port is faithful against a known-good file.
**Never apply that one.** The first real apply waits for a shipment that
hasn't been received; the post-apply re-fetch plus a `syncStockFromErply()`
run then confirms it reaches Supabase.
