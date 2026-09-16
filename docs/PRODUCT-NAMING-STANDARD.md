# Product naming standard

Decided 2026-09-16. Encoded in `lib/product-naming.ts`, tested in
`tests/product-naming.test.ts`, audited by `node scripts/audit-product-names.ts`.

## The format

```
<Descriptive Name> [Size] - <pk>/pk <bx>bx/cs cs.<total pieces per case>
```

```
Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120
Party Crown Tiara 15cm - 144/pk 10bx/cs cs.1440
Pizza Squishy - 12/pk 8bx/cs cs.96
```

**`cs.N` is always the total pieces per case, so `cs === pk × bx`** (Dragon,
2026-09-16). Title Case, never ALL CAPS. Size is written as the product is
sold — inches, cm or feet — and is not converted.

This is not invented: of the 3,225 live catalog names, 3,013 (93%) already
carry the pack-spec suffix, exactly one is ALL CAPS, and sizes appear as
inches (315), cm (131) and feet (29).

## Where names live

`products.name` is overwritten from Erply on every sync (`lib/product-sync.ts`
— `name` is not in `skipFields`). **Renaming in Supabase alone is undone by the
next sync.** Corrections must be written to Erply.

## Translating supplier descriptions

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
- **Invoice lines group colourways.** Line 1 of EGSU9522424 is 50 cartons /
  600 pieces, which is precisely the four `F288023-WN/BLK/LPK/VLT` rows
  (15+15+15+5 cartons, 180+180+180+60 pieces). Cartons and pieces reconcile
  exactly, so the join is reliable — but it is inference, and the colour comes
  from the SKU suffix, not the invoice.

That is why generated names belong behind a review screen, never an automatic
write.

## The audit, and one trap in it

`node scripts/audit-product-names.ts [--csv]` is report-only. Current state:

| | count |
|---|---|
| Compliant | 2,367 |
| `cs.N` is not `pk × bx` | 435 |
| No pack spec at all | 422 |
| Cosmetic (whitespace, ALL CAPS, digit prefix) | 4 |

**Do not bulk-fix the 435 by recomputing `cs.N` as `pk × bx`.** The mismatch
proves the name is internally inconsistent; it does not say which of the three
numbers is wrong, and recomputing is the wrong guess for a large class of them.

Verified against real shipments on 2026-09-16:

| SKU | Shipment says | Name says | Verdict |
|---|---|---|---|
| F287672 | 10 cartons, 1,500 pcs = **150/case** | `48/pk 150bx/cs cs.150` | `cs.N` is right, `bx` holds the wrong value. Recomputing would write **cs.7200** — 48× too high |
| F287778 | 10 cartons, 1,500 pcs = **150/case** | `48/pk 150bx/cs cs.150` | same |
| T642121 | 50 cartons, 3,000 pcs = 60/case | `12/pk 5bx/cs cs.60` | consistent and correct |
| F287491 | 25 cartons, 900 pcs = 36/case | `1/pk 36bx/cs cs.36` | consistent and correct |

So `auditProductName()` deliberately offers **no suggestion** for a
`case_total_mismatch` — only for unambiguous cosmetic problems. Fixing those
435 needs a per-SKU check against a supplier document or a physical count. The
invariant governs names written from here on.

The cross-check method that produced that table: read `pk/cs`, `箱数 CTN` and
`总PCS` from a container's Arrival/Original List, divide pieces by cartons to
get the true per-case count, and compare against the name's parsed spec.

## Verifying the 435 against supplier documents (2026-09-16)

A physical count wasn't available, so the check was done against the supplier
paperwork instead — `node scripts/verify-pack-specs.ts [--csv]`, report-only.

Every "Original List" / "Arrival List" workbook states, per SKU, the total
pieces and the carton count for that shipment. Pieces ÷ cartons is the real
per-case quantity, and unlike the sheet's own `pk/cs` column its meaning can't
be misread. 944 workbooks were scanned, 572 parsed (the rest have no 货号
column — commercial invoices, other suppliers' layouts), yielding 2,396
distinct SKUs of evidence.

| Verdict | Count |
|---|---|
| **Confirmed** by the documents | 300 (271 with a complete corrected name) |
| Documents **disagree** with each other | 26 |
| SKU in **no** document scanned | 109 |

**Which field is wrong varies — that's the whole reason a document has to
decide it.** Of the 271:

- **235: `cs.N` was already right and `bx` was the wrong field**, holding the
  case total instead of the box count.
- **36: `cs.N` itself was wrong.** In 23 of those the document's figure equals
  the original `pk × bx`, so for those specific SKUs the arithmetic fix would
  have been correct.

```
F287294  Foam Bear with Heart 7cm - 12/pk 120bx/cs cs.120
      -> Foam Bear with Heart 7cm - 12/pk  10bx/cs cs.120     (120/case confirmed, bx was wrong)

F287771  ... - 20/pk 50bx/cs cs.50
      -> ... - 20/pk 50bx/cs cs.1000                          (1000/case confirmed, cs.N was wrong)
```

So neither "keep cs.N" nor "recompute cs.N as pk × bx" is a rule you can apply
blind — F287672 is real (150/case, recomputing would have written cs.7200) and
so is F287771 (1000/case, which IS pk × bx). The document figure is the
authority in both directions, which is why `auditProductName` still refuses to
suggest anything for a mismatch on its own.

> An earlier version of this section claimed `cs.N` was right in *every*
> confirmed case. That was an overgeneralisation from the first examples the
> script printed — the 225-product floral-paper group dominates the output and
> all of it fits that shape. Corrected 2026-09-16 after grouping all 271.

By correction pattern:

| Count | Correction |
|---|---|
| 225 | `20/pk 60bx/cs cs.60` → `20/pk 3bx/cs cs.60` |
| 18 | `20/pk 50bx/cs cs.50` → `20/pk 50bx/cs cs.1000` |
| 8 | `20/pk 100bx/cs cs.100` → `20/pk 50bx/cs cs.1000` |
| 6 | `10/pk 100bx/cs cs.100` → `10/pk 10bx/cs cs.100` |
| 3 | `12/pk 120bx/cs cs.120` → `12/pk 10bx/cs cs.120` |
| 2 | `60/pk 20bx/cs cs.20` → `60/pk 20bx/cs cs.1200` |
| 2 | `200/pk 10bx/cs cs.10` → `200/pk 1bx/cs cs.200` |
| 1 each | seven one-offs — `F287039` (96 → 1500/case) and `D701018` (100 → 360/case) are the largest jumps and deserve an eyeball before they're applied |

The 225 are one repeated data-entry habit across the floral-paper range, not
225 independent mistakes.

The 29 confirmed-but-not-auto-fixable ones are those where the documents'
per-case figure isn't divisible by the name's `pk` — so the pack size is wrong
too, and only a human can say what a pack is.

The 26 disagreements are left alone deliberately; packing genuinely changed
between shipments, e.g. `3D801221` shows 380, 432 and 504 per case across six
shipments, and `F287605` alternates 60 and 100. Averaging or taking the latest
would be the same guess this whole exercise avoids.

Full per-SKU detail, including which document each figure came from, is in
`data/pack-spec-verification.csv` (`--csv`).

Remember names are synced FROM Erply, so applying any of these corrections
means changing them in Erply, not Supabase.
