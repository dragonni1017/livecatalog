# Product naming standard

Encoded in `lib/product-naming.ts`, tested in `tests/product-naming.test.ts`,
audited by `node scripts/audit-product-names.ts [--csv]`.

## The format

```
<Descriptive Name> [Size] - <pk>/pk <bx>bx/cs cs.<N>
```

Title Case, never ALL CAPS. Size is written as the product is sold — inches,
cm or feet — and is never converted.

## Two conventions for cs.N, both valid

This business sells some products by the piece and others by the pack, and the
naming reflects that:

| | Meaning of `cs.N` | Test | Example |
|---|---|---|---|
| **Piece-sold** | pieces per case | `cs = pk × bx` | `Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120` |
| **Pack-sold** | **packs** per case | `cs = bx` | `10" Gold Gift Bow - 20/pk 100bx/cs cs.100` |

The bows are 20 per pack with 100 packs per case; the floral papers are 20 per
pack with 60 packs per case. Dragon confirmed each.

A name is consistent if **either** test passes. Current measurement:

| | Count |
|---|---|
| Piece-sold | 1,653 |
| Pack-sold | 636 |
| Either (`pk = 1`, so the two agree) | 715 |
| **Neither — the real defects** | **18** |

**The convention is self-identifying from the shape**, so no list of pack-sold
SKUs is needed. An earlier version of this file carried one; it was removed
along with the single-rule reading.

## Better: state the unit. 219 names already do

```
Happy Face Graduation Pen - 12/pk 50bx/cs cs.50pk        <- 50 packs
Safari Friends Animal Pen - 36/pk 18bx/cs cs.18bx        <- 18 boxes
2-in-1 Round Concave Woven Baskets - 1/pk 16bx/cs cs.16set   <- 16 sets
```

97 use `bx`, 87 use `pk`, 35 use `set`. **This is the clearest form in the
catalog and the one to prefer for new names**, because it removes the
ambiguity that everything above is working around — `cs.60pk` on the floral
papers would have answered the question outright.

`pk`, `bx` and `set` all count containers rather than pieces, so a stated unit
means `cs = bx`. An explicit `pcs` means the piece test instead. When a unit is
stated, **only** that test is applied — no falling back to the other, and never
"either", even when `pk = 1`.

Worth knowing how this was found: the parser originally didn't recognise the
form at all, so all 219 were misread as having **no pack spec** and sat in the
422-name "no spec" bucket for a day. Teaching it the suffix moved compliant
names from 2,784 to 3,002 and cut that bucket to 203.

## Two wrong turns, recorded so they aren't repeated

**1. Treating `cs = pk × bx` as the only rule.** It flagged all 600 pack-sold
names as broken — 435 of them loudly, since the rest coincide with `pk = 1`.
Worse, it proposed reverting the 8 Gift Bow renames that had been made
deliberately in an earlier session (`scripts/fix-bows-pack-spec-erply-woo.mjs`
records that reasoning; the tool suggested `cs.1000`).

**2. Treating a supplier document's pieces-per-carton as the case quantity.**
`scripts/verify-pack-specs.ts` scanned 944 supplier workbooks and produced 264
"confirmed corrections" on that basis. It isn't the case quantity for a
pack-sold product: the floral papers' documents read 60 pieces per carton
while the selling case is 60 *packs*. Applying those corrections would have
rewritten 225 correct names.

Both attempts looked well-evidenced. The lesson is narrow and worth keeping: a
pack spec can't be validated from the name alone *or* from shipping paperwork,
because neither states how the product is sold.

## The defect class is empty (2026-09-17)

`node scripts/audit-product-names.ts`:

| | Count |
|---|---|
| Compliant | 3,021 |
| No pack spec at all | 202 |
| **Fits neither convention** | **0** |
| Cosmetic (whitespace, ALL CAPS, digit prefix) | 4 |

All 19 inconsistent names were corrected. `T641077` settled itself by stating
its own unit; the other 18 were confirmed **pack-sold** by Dragon, so `cs.N`
took the `bx` value the name already carried, written with its unit:

```
White Small Ribbon 1.5" - 15/pk 3bx/cs cs.36     ->  ...cs.3pk
Ribbon 2.5cm - 20/pk 7bx/cs cs.300               ->  ...cs.7pk
Solid Purple Flower Lei - 12/pk 25bx/cs cs.288   ->  ...cs.25pk
Strawberry Crochet Flower - 12/pk 22bx/cs cs.256 ->  ...cs.22pk
```

The assumption, since a name can't prove it: `bx` was taken as correct and
`cs.N` as the typo. The reverse would mean cases of 300 packs of 20, or 288
packs of 12 — implausibly large and unsupported by the supplier documents.

Applied to Erply, WooCommerce and Supabase: 16 / 16 / 18 updated and verified,
1 already correct, and **2 skipped by the guard** — `F284020-LP` and
`T641546-1` are **absent from Erply entirely**, and their WooCommerce names
carry a `SKU - ` prefix the catalog version lacks. Their Supabase names are
corrected; Erply and Woo are untouched. Being missing from Erply is the bigger
issue for those two, since the sync deactivates SKUs absent from the incoming
set.


## The 202 with no pack spec

Investigated 2026-09-17. Only a handful have any pack data in the name:

| | Count |
|---|---|
| No numbers at all — "Pink Solid Wrapping Paper" | 154 |
| Digits that are sizes, not pack data — `80cm`, `1.5"`, `20"` | 42 |
| `N/cs` only — `96/cs`, `240/cs` | 3 |
| `N/pk` only — `20/pk` | 3 |
| Fully specified in an older notation | 1 — **fixed** |

The one that could be fixed mechanically was `P257281`, which already stated a
complete spec in an older form:

```
Kappy Fur Pen Giant 12pcs/bx 24bx/cs 288/cs 25x25x25 42lbs
   ->  Kappy Fur Pen Giant - 12/pk 24bx/cs cs.288
```

12 x 24 = 288 confirmed it, so nothing was inferred. Its trailing
`25x25x25 42lbs` was dropped from the name, since no other name carries carton
figures — but those were the product's ONLY carton figures, so they were not
discarded: Dragon confirmed 2026-09-17 that the dimensions are inches, and they
are now stored as `25 x 25 x 25 in / 42 lb` with
`measurements_source = 'manual'` and `measurements_updated_by =
'legacy-name:P257281'`. They passed `implausibleCaseMeasurement` first.

They were deliberately NOT written before that confirmation: "25x25x25" states
no unit, and `case_*` feeds bin-capacity maths where a cm/inch mix-up is
silent and wrong — the trap migration 0045 exists to guard.

**The remaining 201 can't be fixed from the name**, and the data has to come
from somewhere else. The supplier documents get part-way: **167 of the 203 had
an agreed case quantity** (12 disagree across shipments, 24 appear in no
document). But a case quantity alone doesn't make a name — `cs.60` still needs
either `pk` (piece-sold) or the pack count (pack-sold), and the paperwork never
states pack size. That's the same gap that makes `/admin/receiving` ask for
pieces-per-pack.

The workable route, if it's ever picked up: group the 167 by their document
case quantity (all the wrapping papers are 60/carton) and get ONE pack size per
group, rather than 167 separate decisions.

## Where names live

`products.name` is overwritten from Erply on every sync (`lib/product-sync.ts`
— `name` is not in `skipFields`). **Renaming in Supabase alone is undone by the
next sync.** Corrections go to Erply, and `saveProduct` does accept `name`
(unlike `price`, which it silently discards on this account).
`scripts/fix-bows-pack-spec-erply-woo.mjs` is the proven template: it writes
Erply and WooCommerce separately rather than trusting the integration's
product sync to carry a change across.

## Translating supplier descriptions for new products

New products arrive with no usable English name. `品名` on the supplier sheets
is mostly empty (3 of 12 rows on container EGSU9522424). The English exists on
the **Commercial Invoice**, in customs phrasing:

```
Party Crown Tiara Style 15cm - 100% Zinc Alloy
Squeeze Toy Giant Drumstick Style - 100%TPR
```

`normalizeDescriptor()` rewrites that into house shape: it strips the
`- 100% <material>` tail (0 of 3,225 catalog names use it), drops the filler
word "Style" (19 of 3,225), and removes a legacy `1234 - ` SKU prefix.

Two joins are needed and neither is free:

- The invoice's `Item#` is a **line number, not a SKU**.
- **Invoice rows group colourways**, and different rows can share a
  (cartons, pieces) signature — EGSU9522424 has five such pairs. See
  `lib/commercial-invoice.ts`.

That is why generated names go behind the review screen in `/admin/receiving`,
never an automatic write. Receiving assembles a **piece-sold** spec from
pieces-per-case ÷ pieces-per-pack; if a new product turns out to be pack-sold,
the name needs adjusting by hand.

## Applying an agreed correction

`node scripts/fix-product-names.ts [--apply] [--only=SKU]` — dry run by
default. Generalised from `scripts/fix-bows-pack-spec-erply-woo.mjs`, which
did the same job for the 8 Gift Bows.

It writes all three systems, each for its own reason: **Erply** because it's
the master and a Supabase-only rename is undone by the next sync;
**WooCommerce** directly, because Erply's WooCommerce Integration product sync
has been unreliable and manual-trigger-only; **Supabase** so the catalog shows
the corrected name immediately rather than waiting for 08:00 UTC (the next
sync writes the same value, so there's no fight).

Every entry declares the name it expects to find. If the live name differs —
edited by hand, or already corrected — that system is **skipped and reported**,
never overwritten. So it's safe to re-run, and each write is verified by an
independent re-read rather than trusting the API's own response.

Corrections live in the `CHANGES` array in that script, each with its
reasoning, because nothing here is inferred: the audit proposes no fix for an
inconsistent spec, so every entry is a human decision.

Applied so far: **T641077** (2026-09-17) — `cs.24bx` → `cs.48bx`, the one of
the 19 that settled itself by stating its own unit. Verified in all three
systems.
