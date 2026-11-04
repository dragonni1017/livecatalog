---
name: project-case-count-review-20261104
description: 2026-11-04 /admin/case-count-review (migration 0072, #220): owner decides each disputed case count with every source side by side; 72 rows loaded (36 shipment report, 36 photo labels); shipments disagree with each other; notes counted pack-sold cases in PACKS; QuickBooks-only and pack-structure leftovers listed
type: project
---

**What it is.** `/admin/case-count-review` lists products whose case count
(pieces per case from the name's pack spec, the `case_pieces` column) disagrees
with other evidence. `case_count_review_items.evidence` is a jsonb list of
`{source, count, detail}`, so every source shows side by side; none is
picked. "Use N" builds the name with only the case part changed
(`withCaseCount` in `lib/case-count-review.ts`, keeping the cs.N convention);
"Change case count" renames through `lib/product-name-fix.ts` (audit first,
Erply, Woo, catalog); "Name is right" keeps it. `checkCaseCountChange` refuses
any change to the description or pieces per pack. Prices are per piece or
pack, so they don't change.

**Shipments disagree with each other**, e.g. 3D801205 arrived at 12, 36, 48,
84 and 96 per case, and older stock may still be on the shelf. That is why
the latest shipment is evidence, not the answer. The person who knows the
warehouse stock should decide.

**Loaded 2026-11-04 (72 rows, all pending):**
- Batch `2026-11-04` (36): `scripts/load-case-count-review.ts` from
  `Case_Count_Change_Report.xlsx` (built 2026-09-09 from shipment history and
  the 2026-09-04 QuickBooks list). Only active products whose name differs
  from the latest shipment. SKUs must be matched case-insensitively (the
  report spells `-60CM` where the catalog has `-60cm`).
- Batch `2026-11-04-labels` (36): the case-count findings of the photo
  proofread in [[project-descriptions-no-source-20261026]], transcribed to
  `data/case-count-label-findings-20261104.csv` and loaded by the local
  `data/load-case-count-labels.mts`. 5 products already in the shipment batch
  got the label evidence added to that row instead of a second row.

**Gotcha: the proofread notes count pack-sold cases in packs.** For a name
like `20/pk 60bx/cs cs.60`, "QuickBooks 50 against 60" means 50 packs (1,000
pieces), not 50 pieces. F287507 was converted; the other two pack-sold
findings (F286668, P273583) were already in pieces. Check the convention
before turning a note into a count.

**Left out, still open:**
- QuickBooks looks wrong, name and label agree: 3D801158 and S146887 (144).
  Also 3D801256/57/59, P273761, F287680-BAG from the notes.
- No pack spec in the name: T641666, P273819, P257285, P273848,
  P273859-35CM, P273854.
- Pack-structure questions (packs per case, pieces per pack, inverted
  layouts), not case-count-only: F287431, G333163, F287317, F287318,
  P257247, P256993, T641209, F287769, F287781, F287780, F287778, F287820,
  F287746, P257280.

**Why:** the case counts were scattered across a spreadsheet and prose notes,
in mixed units; this records where each row came from.
**How to apply:** load new evidence as a new batch or merge it into a
product's pending row (never a second row per product); convert pack counts
to pieces first.
