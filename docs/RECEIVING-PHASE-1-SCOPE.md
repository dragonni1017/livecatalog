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
- **Unmatched SKUs** — staged and visible, and not appliable *until* they're
  created as products (Phase 2). Creating one re-resolves its line to
  `matched`, so the same pass can then receive its stock. Barcode mismatches
  are never appliable and never creatable — that SKU already exists and only
  its UPC disagrees.

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

---

# Phase 2 — new products from a shipment (built 2026-09-16)

Unmatched SKUs can now become real Erply products, reviewed one row at a time.
Migration `0049_shipment_new_products.sql`.

## Where each field comes from

| Field | Source |
|---|---|
| SKU, pieces, cartons | Arrival/Original List |
| Pieces per case (`cs.N`) | Derived as pieces / cartons — not read from the sheet's own `pk/cs` column, whose meaning is ambiguous. Verified: S162782 ships 1,920 in 80 cartons and its `pk/cs` reads 24 = 1920/80 |
| English name | Commercial Invoice `Descriptions of Goods`, rewritten by `normalizeDescriptor()` |
| Colour / variant | The SKU suffix (`-WN` → Wine). Unknown codes pass through verbatim |
| Pieces per pack | **The admin.** Nothing in the paperwork says how a case is split into packs |
| Category, price | **The admin.** Categories come from Erply's own group tree |

## The invoice join

The invoice has no SKU column at all — `Item#` is empty on every row and the
leading number is a line counter. Rows also **group colourways**: the four
`F288024-*` rows total 900 pieces in 50 cartons, which is exactly invoice
line 25 ("Flower Decorative 6-in-1 Set Cylinder 25cm").

So `joinInvoiceToLines()` matches by arithmetic, strictest tier first: a single
SKU matching cartons AND pieces; then a base-SKU family summing to a row; then
a unique pieces-only match. A tie matches nothing — the same "unique or hold"
rule as the QuickBooks customer matcher. The basis is shown in the UI, never
hidden, because a family-share match is an inference.

### Colliding signatures — the bug this nearly shipped with

Different invoice rows can carry the SAME (cartons, pieces). EGSU9522424 has
**five such pairs**, including 50/600 for both line 1 ("Flower Decorative
6-in-1 Set") and line 23 ("Plush Toys Axolotl 60cm"). Lines 1 and 25 even
share a description while differing in quantity.

The first cut resolved that collision by processing order, and confidently
named the F288023 florals "Plush Toys Axolotl" while handing the axolotl's row
to P273816-60cm — two wrong product names, produced silently. Nothing but
running the real files end to end would have caught it.

A shared signature now disqualifies a row from automatic matching entirely.
The affected SKUs come back with basis `ambiguous`, carry the full candidate
list in place of a description, and are never given a proposed name.

## What is deliberately not automatic

Names are proposed as a **descriptor only**, with no pack spec. The sheet says
how many pieces are in a case but never how they're packed, and a name
asserting "12/pk" that nobody checked would be an invented fact. The UI
assembles the full house-standard name once the admin supplies pieces-per-pack,
and refuses a value that doesn't divide the case evenly (`cs.N = pk × bx`).

## Verified against live Erply (read-only)

`getProductGroups` returns 19 top-level groups (Drinkware, Florals/Gifts,
LED/Electronics, Seasonal Items, Toys, 3D, …). That response corrected two
assumptions: there is no `nameEN` field on this account, and groups are a
**tree** — `subGroups` are flattened into path-style labels so a child
category is reachable in the picker.

## saveProduct: tested for real 2026-09-16 — one finding

`createErplyProduct()` (`saveProduct`) has **never been called**. It sends
`code`, `name`, `groupID`, `price`, `status` and optionally `code2`, and
deliberately touches no other price field — on 2026-08-04 a wrong saveProduct
parameter zeroed all 2,871 selling prices. **Create exactly one product first
and check it in Erply before trusting a batch.** Creation is one-way; this
repo cannot delete an Erply product.

### Result of the single real create

One product was created end to end through the real route: Erply **#3081**,
code `ZZTESTCLAUDE0916`, name `ZZ TEST DELETE ME Claude Receiving Check -
12/pk 2bx/cs cs.24`, group "Default group". It was **archived immediately**
(`status=ARCHIVED`, `active=0`), so the daily 08:00 UTC sync — which pulls
active products only — can never bring it into the catalog or WooCommerce.
The test shipment row was deleted from Supabase.

What worked: code, name, product group, the per-line record of the new
productID, and the guard that refuses to create the same line twice.

**What did NOT work: the price.** The product was created with `price=1.23`
and Erply stored **0** — both `price` and `priceWithVat` read back as 0, while
a real product (F287491) carries `price=11`. So `saveProduct`'s price
parameter is ignored on this account, and the correct mechanism is still
unknown; `pricelistID`/`savePriceList` appear in this repo only for tier
discount rules, not base price.

Consequence: **a created product lands at $0.00.** Until the right mechanism
is found, the create route reads each product back and, when the stored price
doesn't match, persists a `WARNING:` on the shipment line telling the admin to
set the price in Erply by hand. A $0.00 product that reached the catalog would
be sellable for nothing, so this is not a cosmetic warning.

Determining the right parameter needs more writes against live Erply and was
not attempted.

### Price probe, 2026-09-16 — saveProduct cannot set price on this account

Probed against test product #3081 only (archived throughout, except for one
deliberate ACTIVE window of a few seconds to rule out status as the cause;
re-archived and verified in the same run).

Six attempts, **every one returned `responseStatus: ok` and left the price at 0**:

| Attempt | Result |
|---|---|
| `price=1.23` | ok, price stayed 0 |
| `priceWithVat=2.34` | ok, price stayed 0 |
| `vatrateID=1` + `price=3.45` | ok, price stayed 0 |
| `vatrateID=1` + `priceWithVat=4.56` | ok, price stayed 0 |
| `status=ACTIVE` + `price=5.67` | ok, price stayed 0 |
| `price=6.78` while ACTIVE | ok, price stayed 0 |

Ruled out:

- **Permissions.** The API user is "Dragon Ni", group *administrators /
  management*, with `rightChangePrices=1`, `rightEditStockAndProductCost=1`.
- **Archived status.** Same silent no-op while ACTIVE.
- **Missing VAT rate.** The product already carries `vatrateID=1`, same as a
  real product; sending it explicitly changed nothing.

What prices look like when they DO exist: `getProductPrices` for F287491
returns `defaultPrice: "11.0000"`, `specialPrice: "11.00"`. The account has
nine price lists — Distribution / Wholesale / Chains / Inclusive / Retail plus
four derived percentage ones ("Wholesale (base +20%)" etc.) — and
`getPriceLists` returns **no per-product rules** for them, so per-product
prices don't live there either.

**The lead:** `getServiceEndpoints` shows this account has a dedicated
**`pricing`** service at `https://api-pricing-us.erply.com/`, alongside `pim`,
`inventory`, `sales` and the `crm` one this repo already uses for customer
groups. Product prices almost certainly belong to it, which would explain the
classic API's silent no-op. Its route shape is unknown — three guessed paths
returned 404 and probing stopped there rather than fire blind writes at a live
service.

Worth noting as evidence: the 2026-08-04 incident (a wrong `saveProduct`
parameter zeroing all 2,871 selling prices) means `saveProduct` DID write
prices on this account at some point. If that's still true elsewhere and not
here, something about the account's pricing configuration changed in between —
a question for Erply support, and the cheapest next step.

A product created by this app therefore has **no price**, and the create route
flags each one per line.

**DECIDED 2026-09-16 (Dragon): pricing is set by hand in Erply.** This is not
an open blocker and does not need chasing — don't re-probe the Erply pricing
service or re-litigate the `saveProduct` parameter. The price a line carries
(`shipment_lines.proposed_price_cents`) is a record of the intended price and
a worklist for the manual pass, not something the app can push.

### One pass, both kinds of line (2026-09-16)

Receiving now finishes a whole container in one visit. It sorts every line at
staging (`matched` / `unmatched_sku` / `barcode_mismatch`), the new SKUs get
created as products, and **creating one re-resolves its line to `matched`, so
its stock is appliable in the same session.**

That flip is the fix for a real hole: `match_status` was set once at staging
and nothing updated it afterwards, while apply only accepts `matched`. So a
container's new products were created and their received pieces had nowhere to
go — and re-uploading the workbook didn't help, since the unique `file_hash`
reopens the same shipment with the same stale classification. On the real
EGSU9522424 container that was 24 of 34 SKUs and 67,668 of 86,484 pieces.

Order matters: create first, then apply. The apply button's count is live, so
it grows as products are created.

The two rules live in `lib/receiving.ts` as pure predicates
(`isStockAppliable`, `isCreatable`, `missingForCreate`) precisely because they
have to agree — the UI's enable/disable logic and the route's validation both
read the same ones, and `tests/receiving.test.ts` asserts no line can ever be
both creatable and appliable at once.

`barcode_mismatch` is excluded from both. Creating one would ask Erply for a
duplicate code (the SKU is already in the catalog) or produce a second product
for the same item; applying one would add stock to a product whose barcode
disagrees with the sheet, which no later sync corrects.
