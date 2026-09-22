---
name: project-containers-20260917
description: 2026-09-17 — three arrival lists (EMCU8323054/EGSU8096690/EGSU1396926) dry-run through receiving; found+fixed two staging bugs; 68 of 92 SKUs are new, K229582 spans two containers
type: project
---

Three containers landed 2026-09-17 (ETA 09-17-2026, all ETD 0904). Their
Arrival Lists were parsed and classified through the real receiving code
**parse-only — nothing staged, nothing applied, no Erply call.**

| Container | sheet | SKUs | pieces | matched | new | barcode_mismatch |
|---|---|---|---|---|---|---|
| EMCU8323054 | 实装 | 37 | 117,440 | 9 | 26 | 2 |
| EGSU8096690 | Sheet1 | 40 | 48,456 | 6 | 34 | 0 |
| EGSU1396926 | 实装 | 15 | 66,036 | 7 | 8 | 0 |

Zero parse rejections on all three; `总PCS` format throughout, cm/kg headers.

**Two real staging bugs, found by these files and fixed the same day:**

1. `normalizeBarcode` only trimmed *surrounding* whitespace, so EGSU1396926's
   `6  8140239892 8` read as a different barcode from the stored
   `681402398928` and T641449 (6,000 pieces) was excluded from apply. Now
   strips every non-digit. Regression test in `tests/packing-list.test.ts`.
2. The staging route looked the catalog up with `.in('sku', …)` — Postgres is
   case-sensitive, so EMCU8323054's lower-case `p273762` never matched the
   existing `P273762`, stranding 4,800 pieces *and* queueing a duplicate
   product for creation. The surrounding map was already upper-cased, so the
   intent was there and only the query was wrong. Now queries both casings.

**Data problems these files exposed (not fixed — need a human call):**

- **K229480's short barcode — "fixed" 2026-09-17, REVERTED 2026-09-18. Do not
  redo this.** Both systems held 11 digits (`73787910121`) against the arrival
  list's `737879101216`, and that was rewritten in Erply and Supabase on the
  theory that a UPC-A had lost its check digit. **The theory was wrong.**
  Barcode length varies legitimately on this account depending on when the
  product was set up (Dragon, 2026-09-18) — 11 digits is not evidence of
  truncation. The supporting arguments were both hollow: a check digit that
  "validates" proves nothing, because appending the correct check digit to
  *any* 11 digits yields a valid UPC-A, and a neighbouring SKU sharing a
  prefix is not a second source. Restored verbatim in Erply then Supabase, 0
  other fields drifted; both one-shot scripts deleted.
  A paginated census (11 short barcodes, not the 4 first reported — that
  count came from an unpaginated query silently capped at PostgREST's 1000
  rows) shows the shape: `11:11, 12:2929, 13:3, 14:1` across 2,944 barcoded
  products. The 11 under-12s are F286653-WT, K01873, K01881, K01885, K02203,
  K02311, K02561, K02565, K229480, L61981, T642055 — i.e. a whole `91671…`
  cohort *and* several `73787…`, which is exactly what an era-of-setup
  difference looks like rather than a set of individual typos.
- **K229479 is a genuine mismatch**, correctly flagged: sheet says
  `0034635763`, catalog says `737879101209` — a different UPC series
  entirely, not a formatting difference.
- **K229582 ships on two of the three containers** (2,160 on EMCU8323054,
  2,640 on EGSU8096690) and is new in both. Create it from whichever
  container is staged first; the second shipment's line will still say
  `unmatched_sku` and *cannot* be re-staged to pick up the new product,
  because the unique `file_hash` reopens it with its stale classification.
  Either stage the second container after the create, or its 2,640 pieces
  strand.
- ~~S121037's carton figures are impossible~~ — **our bug, not the
  supplier's. Fixed 2026-09-18.** The "3.35in cube at 41.89 lb" and the 91 of
  92 blank cartons had the same cause: `lengthDim: ['长']` matched the first
  header containing 长, which on the 2026 format is the *product*-spec column
  `产品规格尺寸长*宽*高（CM）` sitting left of the real `长cm(外箱)`. One cell
  contains 长, 宽, 高 and "CM", so all three axes collapsed onto it — text
  cells like `"57*57CM"` nulled the carton silently, numeric ones produced an
  L=W=H cube. Both copies now prefer the column marked `外箱` (outer carton)
  and throw rather than choose between unmarked candidates. After the fix all
  92 lines carry real cartons, 0 cubes; S121037 reads 25 x 12.6 x 9.84 in at
  41.89 lb. Do NOT record this as bad supplier data — see
  [[project-product-measurements]] for the 28 that genuinely are.

**Commercial Invoices found 2026-09-18** in the OneDrive `import documents`
folder (not Downloads), one per container alongside an Original List and a
Packing List. All three parse and reconcile *exactly* — invoice cartons equal
the `NNNctn` in the filename and invoice pieces equal the packing list's
total, on all three. Arrival List and Original List are byte-for-byte
equivalent for parsing purposes; either works.

Auto-naming covers **34 of the 68 new SKUs** (28 priced), and the shortfall is
structural rather than a defect: **the invoice describes goods by customs
category, so one row covers many SKUs** — EGSU8096690's single "Garland
Ribbons 4cm" row (247ctn/8,600pcs) spans all 20 unmatched `FD400*-25YARD` /
`FD500*` ribbons, and EMCU8323054 has 20 invoice rows for 37 SKUs. The join
refuses to split an aggregate row, which is correct; those SKUs need a name
typed by hand. EGSU1396926 is the clean case at 8/8 named. The Original List
also carries a 品名 column the parser ignores (F288116's is `金边/香槟金`,
"gold trim / champagne gold") — that is exactly what distinguishes invoice
lines 1-4 from each other, so it's the obvious input if auto-naming is ever
pushed further.

**How to apply:** 68 of the 92 SKUs are new, so most of these pieces can't be
received until Phase 2 creates the products. Pricing stays a manual Erply step
either way.
Receiving on top of the fake 1000 stock is fine — see
[[project-fake-stock-1000-hold]]. Parser/flow background in
[[project-receiving-phase-1]].

**Open, blocked on a permission prompt (2026-09-18):** a shipment for
EMCU8323054 is already staged (`a6b93a58-090e-4e3c-8b19-3968f5ac96ed`, staged
2026-09-17 20:25 UTC) and carries the **pre-fix classification** — it froze
`p273762` as `unmatched_sku`, so creating products from it would duplicate the
existing `P273762` and strand 4,800 pieces. Nothing is applied and nothing
created, so it is safe to delete, but a re-upload cannot fix it: the unique
`file_hash` reopens the same rows, and `abandoned` does not release the file
either, because the POST lookup doesn't filter on status. **There is no DELETE
route** — `app/admin/api/shipments/route.ts` has GET/POST/PATCH only, so
removing a stale shipment needs SQL:
`delete from shipments where id = 'a6b93a58-090e-4e3c-8b19-3968f5ac96ed';`
(lines cascade). **RESOLVED 2026-09-18:** the stale shipment was deleted, and
`app/admin/api/shipments` now has a guarded `DELETE ?shipment_id=`, so this no
longer needs the SQL editor. The guard is `blockersForDelete` in
`lib/receiving.ts`, next to the apply/create predicates so the UI and the
route can't drift. It blocks on ANY irreversible work — an applied status, any
`applied_at`, any `erply_created_product_id` — because those rows are the only
record that a one-way Erply add happened: deleting them would hide the receipt
rather than reverse it, and would let the same file be staged and applied a
second time. Verified live against a throwaway row: a delete guarded on a
stale status returns 0 rows without erroring (so the route 409s rather than
silently reporting success), the matching status returns 1, lines cascade with
no orphans, and the freed `file_hash` re-stages. The "Previous shipments"
table on `/admin/receiving` calls it, running the same predicate client-side
to decide whether to offer the button — the history rows don't carry their
lines, so it sees status alone for every row but the one currently open, and
the server is what actually refuses. A blocked row reads "kept as a receipt"
with the reasons in its title. Note this is distinct from **abandon**, which
sets `status='abandoned'` but leaves the row holding the `file_hash`, so a
re-upload reopens the abandoned shipment with its stale classification —
abandon is not a way to re-stage a file.

**STAGED 2026-09-18** (by dragon@ly-usa.com, from the OneDrive *Original
List* of each): all three containers are in `shipments` as `staged`, counts
verified against prediction row by row — 37/117,440, 40/48,456, 15/66,036,
with 92 of 92 lines carrying real cartons and 0 cubes. Nothing applied,
nothing created.

Worth knowing for next time: a first attempt appeared to succeed on screen
but reached no server — `shipments` stayed empty and `audit_log` had no
`shipment_staged` row for that day. The dev server simply wasn't running, and
`/admin/receiving` redirecting to `/admin/login` read as "localhost is
broken". **`audit_log` filtered to `entity_type = 'shipment'` is the quickest
way to tell whether a stage actually happened** — but note it only records
actions taken through the routes, so a direct DB write (like the stale-row
delete earlier that day) leaves no trace there.

Also confirmed: **staging writes to the live Supabase from localhost too** —
`.env.local` points at the same project as production (`aguorduaxfqrvvywgrdi`),
so a local dev server is not a sandbox. Harmless while staging, which touches
no Erply, but it is the same data Apply would act on.

**Next step is NOT Apply.** 68 of the 92 SKUs still need creating, only 34 of
those have an auto-filled name, and K229582 must be created from EMCU8323054
before EGSU8096690's copy is worth anything — delete and re-upload that
container afterwards so its line flips to matched. Applying now would
register the 54,972 matched pieces and leave the rest stranded mid-container.

**Categories set 2026-09-22** via `scripts/set-proposed-categories-20260922.mjs`:
57 lines / 56 SKUs, all 8 names validated against live Erply product groups
with the same check the create route runs (Ribbons 20, Floral Papers 14,
Plush Toys 6, Flowers 6, Keychains 5, Seasonal Items 4, Squishy / Slime 1,
Bags/Purses 1). Two useful facts from that pass:

- **Erply has 73 assignable group names, not 19** — the 19 are top-level and
  the create route matches any node by name, subgroups included. `Floral
  Papers` is a real group and is the right home for the 14 "Glossy Floral
  Paper" SKUs, which a keyword rule wrongly wanted to file under `Flowers`.
  Near-duplicate groups exist from different import eras (`TOY` vs `Toys`,
  `Keychain` vs `Keychains`, `Ribbon` vs `Ribbons`, `Bag/Purse` vs
  `Bags/Purses`) — the plural forms are the ones in use.
- 11 lines deliberately left blank: 7 awaiting a category decision
  (D701142 lights, D701141 balloon, D701140 Thanksgiving, K229580
  Christmas keychain, F288146/F288147 brooches, F288106 cellophane) and the
  4 with no name (F287759, S162786, CM072601, H424272).

Still blocking creation: **prices are blank on all 68 lines** and the create
route requires them, even though Erply cannot accept a price over the API —
`proposed_price_cents` is the record of intent for the manual Erply pass.
And **creating and applying both need Erply, which is not configured on
Vercel**, so both steps run from a local dev server or need `ERPLY_*` added
there. Filling names does NOT — that route only touches Supabase.

**Names filled and price placeholdered 2026-09-22.** The QuickBooks fill ran
through the UI (audit: `63 SKUs / 64 lines` — 64 because K229582 is named on
both containers), leaving only F287759, S162786, CM072601 and H424272
nameless. Price was then the single blocker on 57 lines, so
`scripts/price-worklist-20260922.mjs` set **`proposed_price_cents = 0` as a
placeholder** and exported `data/price-worklist-20260922.xlsx` (67 SKUs, one
row per SKU) for a human to price.

**The 0 is safe but must not be read as a decision.** Erply cannot accept a
price over the API on this account, so every product is created at 0
whatever this field says — the placeholder only satisfies the create route's
validation, and the xlsx is the real worklist. DECIDED by Dragon
2026-09-22: placeholder now, human pricing pass afterwards.

**The worklist's invoice-price column came out empty**, because
`invoice_unit_price_cents` is only populated when a Commercial Invoice is
attached to a shipment in the New products panel, which hasn't been done.
The invoices do carry unit prices ($0.70, $0.35, $2.10 …). Attaching each
container's invoice would fill that column through the tested path —
deliberately NOT re-parsed inside the worklist script, since that would
duplicate `lib/commercial-invoice.ts` rather than use it.

State after this pass: **57 of 68 lines creatable** (EGSU8096690 32,
EMCU8323054 19, EGSU1396926 6). The 11 blocked are the 7 awaiting a category
and the 4 with no name.

## Erply categories must be PATH LABELS, not bare group names

Found 2026-09-22 by the single-SKU canary, which is the whole argument for
doing one before fifty-seven.

`lib/erply.ts getErplyProductGroups()` deliberately flattens the group tree
into `Parent / Child` labels so two same-named children under different
parents stay distinguishable, and the create route validates
`proposed_category` against **those** labels. So a bare `Keychains` is
rejected with *'category "Keychains" is not an Erply product group'* — which
reads like the group is missing when it plainly exists as
`General Merchandise / Keychains`.

`set-proposed-categories-20260922.mjs` wrote bare names and "verified" them
against a flat list of raw `g.name` values. **That is the wrong name set and
it passed everything.** 38 of 56 lines would have failed at create time.
Only top-level groups (`Seasonal Items`, `Floral Papers`) were unaffected —
for those, label == name. Repaired by
`scripts/fix-proposed-category-paths.mjs`, which resolves every target
against a live walk using the same algorithm as `lib/erply.ts` and refuses
to write a label that walk doesn't produce.

Two things to carry forward:

- **Validate against `getErplyProductGroups()`, never against raw
  `getProductGroups` records.** The API's tree and the app's label set are
  different things.
- `Squishy / Slime` is itself a group name containing " / ", so its label is
  `Toys / Squishy / Slime`. No split-on-separator heuristic survives that —
  map such names explicitly.

The canary itself (K229581 -> Erply **#3082**) came out correct: code,
`code2` barcode 737879111864, the QuickBooks name verbatim, group Keychains
(33), price 0 as expected since Erply refuses prices over the API, ACTIVE,
and its line flipped to `matched` so the 7,200 pieces became appliable.
