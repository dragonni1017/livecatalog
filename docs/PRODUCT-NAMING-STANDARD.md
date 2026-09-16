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
