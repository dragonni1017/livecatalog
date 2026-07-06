# Handoff: Barcode Leading-Zero Fix (TBarcode mismatch)

**Status:** Code complete and verified — `tsc`/`npm run build` both clean, `barcode_corrections` table confirmed live with correct schema, live barcode-length distribution confirmed (see Progress Log, 2026-06-26). Remaining open items: backfill the 11 known stripped-zero rows and re-check the source spreadsheet's column formatting — both need a session with the external source-spreadsheet folder mounted (not available in the 2026-06-26 session).

**For Claude Code:** read this fully before touching code. Update the "Progress Log" at the bottom as you work.

---

## Goal

User reported the catalog's rendered barcode looks visually different from the same product's barcode printed via the **TBarcode** Excel add-in, and — more importantly — wants confirmation the two actually **scan to the same item**.

## Root cause

Not a styling issue — a data-corruption bug in the Excel import path.

`components/admin/ExcelDropzone.tsx` parses the uploaded sheet with `XLSX.utils.sheet_to_json(sheet)` (default `raw: true`). If the "Barcode" / "GTIN, UPC, EAN, or ISBN" column is a **Number**-typed cell in Excel (common for GTIN template columns, which often use a zero-padding custom number format so they *display* correctly despite being stored as a Number), SheetJS returns the bare numeric value with the leading zero already gone — e.g. a true code `036000291452` comes back as the number `36000291452`.

`app/api/import/route.ts` (line ~44) then does `row.Barcode?.toString().trim()`, which can't recover a zero that was never in the value to begin with.

Downstream, `components/catalog/Barcode.tsx`'s `formatFor()` requires an *exact* digit count (`^\d{12}$` for UPC-A, `^\d{13}$` for EAN-13, `^\d{8}$` for EAN-8). An 11-digit value (one short) fails that check and silently falls back to CODE128 — a different symbology encoding a different, shorter number than the real GTIN. A scanner reading that barcode gets a different value than scanning TBarcode's (presumably correct) output. This is the actual "different item" risk, not just a look-and-feel mismatch.

`scripts/backfill-barcodes.mjs` (the one-off script used to backfill `products.barcode` from the source spreadsheet) has the identical bug via `String(barcodeCell ?? '')`.

## What's already done

Three files changed, all reviewed and logic-tested (see Verification below). No schema changes, no new dependencies.

1. **`components/admin/ExcelDropzone.tsx`**
   - Added `BARCODE_COLUMNS = ['Barcode', 'GTIN, UPC, EAN, or ISBN']` and a `recoverLeadingZeros(rows, sheet)` helper.
   - It re-parses the sheet with `sheet_to_json(sheet, { raw: false })` (formatted/displayed text instead of the bare cell value) and, **only for the two barcode-ish columns**, swaps in the formatted digit string when it's purely digits and strictly longer than the raw value (i.e. it actually recovered a stripped zero). Price/Stock Qty/etc. still use the original raw numeric parse — untouched, no regression risk there.
   - Wired in where `rows` is built: `const rows: ExcelRow[] = recoverLeadingZeros(XLSX.utils.sheet_to_json(sheet), sheet)`.

2. **`scripts/backfill-barcodes.mjs`**
   - `readBarcodeMap()`'s `sheet_to_json(sheet, { header: 1 })` → `sheet_to_json(sheet, { header: 1, raw: false })`. Safe to apply blanket here since this script only ever reads the SKU/Barcode columns (no numeric Price/Stock parsing to protect).

3. **`components/catalog/Barcode.tsx`**
   - Added `normalizeBarcode(value)`: re-pads 11-digit and 7-digit numeric values to 12/8 digits (`'0' + value`) before symbology detection. These two lengths are unambiguous — UPC-A and EAN-8 have no legitimate shorter form in this catalog, so an 11- or 7-digit numeric value is almost certainly the zero-stripped version. **12-digit values are deliberately left alone** — could be a correct UPC-A as-is, or a zero-stripped EAN-13, and guessing wrong would actively encode the wrong number. This is a safety net for rows already corrupted in the DB before fix #1/#2 existed; it doesn't require a re-import to take effect.
   - `formatFor()` and the JsBarcode render calls now operate on `normalizeBarcode(value)` instead of the raw prop. The `aria-label` and the plain-text fallback (when both symbologies fail) also display the normalized value, so what's shown matches what's actually encoded.
   - **Not logged to the audit table below** — this is a render-time-only fallback; it never writes to the DB, so the "original" value is always just whatever is already sitting in `products.barcode`. Nothing extra to retrace here.

4. **Audit log for every auto-correction (new, per user request)**
   The user asked for a paper trail: whenever the leading-zero recovery logic actually changes a value, keep the original so it can be retraced/reverted if a correction is ever wrong.
   - **`lib/types.ts`** — added `BarcodeCorrection { sku, column, original, corrected }`.
   - **`components/admin/ExcelDropzone.tsx`** — `recoverLeadingZeros()` now returns `{ rows, corrections }` instead of just `rows`. Every swap it makes is recorded as a `BarcodeCorrection`. `handleImport()` filters corrections down to SKUs that actually made it into `validRows` (skipped/error rows aren't logged) and sends them as `barcodeCorrections` in the same POST to `/api/import`.
   - **`app/api/import/route.ts`** — accepts `body.barcodeCorrections`, and after `syncToSupabase()` succeeds, calls `logBarcodeCorrections()` to insert them into a new `barcode_corrections` table. Wrapped in try/catch and never throws — a logging failure (e.g. the table not existing yet) must never fail the import itself.
   - **`scripts/backfill-barcodes.mjs`** — `readBarcodeMap()` now does a second `raw: true` (default) read alongside the existing `raw: false` read, purely to detect *when* the formatted re-read actually recovered a stripped zero, and collects those as corrections. After applying updates (and only outside `--dry-run`), `logCorrections()` inserts them into the same `barcode_corrections` table. `--dry-run` instead prints what would be logged.
   - **New Supabase table required — not yet created** (this sandbox has no Supabase network access; run this in the Supabase SQL editor):
     ```sql
     create table barcode_corrections (
       id bigint generated always as identity primary key,
       sku text not null,
       column_name text not null,
       original_value text not null,
       corrected_value text not null,
       source text not null check (source in ('import', 'backfill')),
       corrected_at timestamptz not null default now()
     );
     create index barcode_corrections_sku_idx on barcode_corrections (sku);
     ```
     To retrace/audit later: `select * from barcode_corrections where sku = '<sku>' order by corrected_at desc;`
   - **Until the table exists**, both insert paths fail safely: the import route logs the error to the server console and still returns the normal import result; the backfill script prints a `⚠️` warning but still completes the actual barcode update. Nothing breaks, but nothing gets logged either — create the table before relying on this.
   - **Scope note:** this only logs corrections made by *this* auto-fix logic (the leading-zero recovery), not every barcode field edit in general. A legitimate, intentional barcode change (e.g. a vendor reissues a GTIN) made through a normal re-import is not logged here — only swaps the recovery logic itself made.

## Verification done (this session)

Ran a standalone Node script (outside the repo, importing `xlsx`/`jsbarcode` from this project's `node_modules` via `NODE_PATH`) that:
- Built a synthetic sheet replicating the exact bug scenario (a Number cell with value `36000291452` but formatted text `036000291452`) and confirmed `recoverLeadingZeros` recovers it, while leaving an already-correct 12-digit UPC-A and a non-numeric text SKU (`18-02-3`) untouched.
- Confirmed `normalizeBarcode`/`formatFor` pick the right symbology for representative 7/8/11/12/13-digit and non-numeric inputs.
- Confirmed JsBarcode actually renders all of the above (including real EAN-8/UPC-A checksum-valid codes) without throwing.

All checks passed. **Not done:** an in-repo automated test (the verification script was throwaway, not committed) and a real TypeScript build.

## Known sandbox caveat — re-check this

This session's sandbox had a stale/inconsistent view of the project directory when accessed via its Linux shell mount (e.g. `package.json` read as truncated/invalid JSON via `cat`, but read correctly via the file-edit tool; `tsc --noEmit` reported nonsensical errors — phantom unclosed JSX tags, wrong line counts — in files that were independently confirmed well-formed via direct file reads). This looked like a mount-caching artifact, not a real problem with the edits, but it means **`tsc`/`npm run build` were never successfully run against the real, current files in this session.** First thing to do: run `npx tsc --noEmit` and `npm run build` for real and confirm clean.

## Remaining tasks

- [ ] **Run the `barcode_corrections` table-creation SQL above in the Supabase SQL editor** — required before audit logging actually persists anything. Until then, corrections are detected and applied correctly but silently not logged (see scope note above).
- [ ] Run `npx tsc --noEmit` and `npm run build` — confirm all edited files (now including `app/api/import/route.ts` and `lib/types.ts`) compile clean (this session couldn't confirm it; see caveat above).
- [ ] Query the live Supabase `products` table for `barcode` length distribution (`select length(barcode), count(*) from products where barcode is not null group by 1`) to find out how many existing rows have 7- or 11-digit (auto-recoverable) or 12-digit (ambiguous, needs the source file) barcodes. This session had no network access to Supabase to run this.
- [ ] Re-run the normal Excel import (or `node scripts/backfill-barcodes.mjs <path-to-source-xlsx>` — check `--dry-run` first) against the real source spreadsheet so the fixed parser corrects any already-corrupted `barcode` values in the DB.
- [ ] Open the source spreadsheet (the one feeding TBarcode / the one used for import — likely the file referenced as the default path in `backfill-barcodes.mjs`) and check whether the "GTIN, UPC, EAN, or ISBN" column is formatted as **Text**, or as a Number with a zero-padding custom format (e.g. `00000000000`). Either is fine for this fix to work; if it's plain "General" Number formatting with no padding format at all, the leading zero may already be permanently lost in the source file itself (Excel discards it at the moment of typing), and the only real fix is re-entering those values as Text in the source sheet.
- [ ] For any 12-digit barcodes found to be ambiguous (could be valid UPC-A or zero-stripped EAN-13), cross-check against the source spreadsheet / TBarcode rather than guessing in code.
- [ ] Consider adding the verification script's checks as a real test file (e.g. `lib/__tests__/barcode.test.ts` or similar, if the project ever adds a test runner — it currently has none).

## Out of scope for this pass

- Visual/cosmetic alignment with TBarcode's exact rendering style (font, quiet zone, etc.) — user confirmed the actual concern was scan-to-same-item correctness, not pixel-perfect visual match.
- Erply sync path (`lib/erply.ts`) — barcode comes from the Erply API as `p.code2` (already a string), not from spreadsheet parsing, so it isn't affected by this bug.

---

## Progress Log

*(Claude Code: append entries here as you work.)*

- **2026-06-26 — Verification pass (build/DB confirmed, DB backfill deferred by user).**
  - **`npx tsc --noEmit`: clean.** No errors.
  - **`npm run build`: succeeded.** Had to build from a fresh copy outside the FUSE-mounted repo dir (`/tmp/build-test`, `npm install` + `npm run build`) — building in-place hit the same FUSE-mount `EPERM: unlink .next/...` flakiness this doc warned about. Not a code issue. One unrelated, expected warning: the sitemap generation step logged a `fetch failed` / `EAI_AGAIN` for `*.supabase.co` because this sandbox has no outbound network to Supabase — pre-existing/environmental, unrelated to the barcode fix.
  - **`barcode_corrections` table already exists** in the live DB (`aguorduaxfqrvvywgrdi` project) with the exact schema this doc specifies (id, sku, column_name, original_value, corrected_value, source, corrected_at) — someone already ran the migration. 0 rows currently (no corrections logged yet, consistent with no import/backfill run since it was created).
  - **Live barcode length distribution** (`products`, 3,016 rows total): 11-digit = **11**, 12-digit = **2,918**, 13-digit = **3**. No 7-digit or 8-digit values present.
  - **The 11-digit rows** (unambiguous stripped-zero UPC-A per this doc's design — `normalizeBarcode()` already fixes these at render time, but the stored DB value is still wrong): `F286653-WT` (73787907383), `K01873` (91671105019), `K01881` (91671105064), `K01885` (91671105088), `K02203` (91671007771), `K02311` (91671115353), `K02561` (91671007979), `K02565` (91671008488), `K229480` (73787910121), `L61981` (91671961981), `T642055` (73787088036).
  - **Could not run the real backfill / re-import**: `scripts/backfill-barcodes.mjs`'s default source path (`C:/Users/thien/Downloads/ImageOrganization/ImageOrganization/_handoff/Erply_Product_Import_WC_Format_FINAL.xlsx`) lives outside this session's mounted folder (only `livecatalog/` is mounted) — no access to the real TBarcode source spreadsheet, so the "check column formatting" and "re-run backfill" remaining-task items are still open and need a session with that folder connected.
  - **Offered to directly zero-pad the 11 known-bad rows in the DB** (with matching `barcode_corrections` audit entries, `source = 'backfill'`) as a stand-in for the real backfill, since the correction is unambiguous regardless of the source file. **User declined** — left as-is for now. The 11 SKUs above are documented here so a future session (with the source file available) can run the proper backfill instead.
  - **2,918 ambiguous 12-digit values**: unchanged, by design — still need a source-spreadsheet cross-check before any of these could be touched, same as originally scoped.
  - **Not done this pass**: adding a committed test file (still no test runner in the project, per `CLAUDE.md` — out of scope).

- **2026-06-22 — Added audit logging for auto-corrections (user request).** Added item #4 above: `BarcodeCorrection` type, `recoverLeadingZeros()` now returns corrections alongside fixed rows, `/api/import` logs them to a new `barcode_corrections` table, `backfill-barcodes.mjs` does the same. Verified the correction-detection logic (both the client-side and backfill-script versions) against synthetic sheets via standalone scripts — both correctly flag only the actually-recovered value (`WIDGET-1`) and leave the already-correct one (`WIDGET-2`) and non-numeric one (`WIDGET-3`/skipped) alone. **Table not created yet** — that SQL still needs to be run by hand; until then the insert fails safely (logged warning, import/backfill still completes).
