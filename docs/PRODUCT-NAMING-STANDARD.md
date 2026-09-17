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

## What actually needs fixing: 19 names

`node scripts/audit-product-names.ts` reports them. Current state:

| | Count |
|---|---|
| Compliant | 3,003 |
| No pack spec at all | 203 |
| **Fits neither convention** | **18** |
| Cosmetic (whitespace, ALL CAPS, digit prefix) | 4 |

They fall into four remaining groups (a fifth, `T641077`, is fixed) and read
like typos rather than a third convention:

| Count | Shape | Piece-sold would be | Pack-sold would be |
|---|---|---|---|
| 7 | `15/pk 3bx/cs cs.36` (ribbons F287101–107, F287110) | `cs.45` | `cs.3` |
| 5 | `20/pk 7bx/cs cs.300` (Ribbon 2.5cm F287331–334) | `cs.140` | `cs.7` |
| 5 | `12/pk 25bx/cs cs.288` (fans, leis, headband) | `cs.300` | `cs.25` |
| 1 | `12/pk 22bx/cs cs.256` (F287267) | `cs.264` | `cs.22` |
| ~~1~~ | ~~`12/pk 48bx/cs cs.24bx` (T641077)~~ | — | **FIXED 2026-09-17** to `cs.48bx` in Erply, WooCommerce and Supabase |

The 7 ribbons are interesting: `15/pk` doesn't divide 36, but `12/pk` would
(12 × 3 = 36), so the typo may be in the pack size rather than the total.
That's a guess, not a finding.

`auditProductName` deliberately proposes **no** correction for these — the
spec tells you a name is inconsistent, not which of its three numbers is
wrong.

`node scripts/verify-pack-specs.ts [--csv --xlsx]` adds context from the
supplier paperwork for those 19: documents agree for 2, disagree for 7 (e.g.
`F287106` shows 36 and 40 pieces per carton across three shipments), and 9
appear in no scanned document. It proposes no names either, for the reason
above.

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
