---
name: project-pack-spec-name-plan-20261026
description: 2026-10-26 (#175) — 171 of 172 "Name not to standard" names lack a pack spec. A read-only planner proposes 66 from QuickBooks figures or the approved plush/tumbler/keychain rules; 106 need counting. SKU ranges are not product types, so each rule also needs the product's wording. Dry run clean (2 Woo guard skips). NOT applied yet
type: project
---

**The problem.** On 2026-10-26 the Cleanup tab's "Name not to standard" held
172 active products. 171 had no pack spec at all, which the naming audit
deliberately won't guess (see lib/product-naming.ts and
docs/PRODUCT-NAMING-STANDARD.md). QuickBooks is the source for these
products ([[project-qb-item-pull]]), but it mostly states only a case total
("24/cs", "240pc/cs"), not pieces per pack. And "N/cs" can count pieces or
packs.

**What was built.** `scripts/plan-pack-spec-name-fixes.ts` is read-only. The
logic is pure and tested in `lib/pack-spec-plan.ts`. It writes
`data/product-name-fixes-plan-packspec.csv` (the `fix-product-names.ts --plan`
format) and `data/product-name-fixes-review-packspec.csv` (all rows, with the
rule, the QuickBooks text and the reason). `parsePack`, `buildSpec` and
`plushRule` moved unchanged from `scripts/create-products-from-qb.ts` to
`lib/qb-pack.ts`, so both planners read QuickBooks the same way.

| Rule | Count | Basis |
|---|---|---|
| qb-stated | 12 | QuickBooks gives per-pack and per-case figures that agree |
| qb-derived | 1 | N/pk + M/cs, boxes = M/N; marked VERIFY (T641666, 12/pk 9bx/cs) |
| plush-1pk | 23 | rule approved 2026-10-01 ([[project-qb-product-create-plan-20261001]]) |
| tumbler-1pk | 5 | T6422xx rule approved 2026-10-06, and the product says "tumbler" |
| keychain-12pk | 24 | K229492–K229560 rule approved 2026-10-06, and it says keychain/charm |
| cosmetic | 1 | the audit's own suggestion (F287491 prefix) |
| needs a person | 106 | 74 case total only, 17 no counts or not in QuickBooks, rest incomplete |

**Non-obvious: SKU ranges are not product types.** On the first run the
range-only rules matched T6422xx leather patches, a pill box (480/cs), fans
and a spinner ball as 1/pk "tumblers", and K229517, a bag/wallet, as a
12/pk keychain. Each range rule now also requires the name, QuickBooks
description or QuickBooks category to say what the product is. K-series
plush (e.g. K229521 "8CM Plush Dumplings", 240/cs) are keychain plush, an
accessory the plush rule was approved to exclude, so the plush rule skips
`K*`.

**Status 2026-10-26: NOT applied.** The `fix-product-names.ts` dry run was
clean: 66 would update in Erply and Supabase, and 64 in WooCommerce. The
WooCommerce guard skipped 2 whose Woo names differ: F287982 (old `SKU - …`
format with carton size) and T642232 (`&amp;`). Applying needs the user's
review of the review CSV, then
`node scripts/fix-product-names.ts --plan=data/product-name-fixes-plan-packspec.csv --apply`.
Writes to live systems are blocked from Claude's side. After applying, read
the names back in Supabase rather than trusting the run; see
[[feedback-sql-editor-runs-not-landing]]. Re-running the planner is safe: it
reads live names, so applied rows drop out.
