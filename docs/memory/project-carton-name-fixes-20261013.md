---
name: project-carton-name-fixes-20261013
description: 2026-10-13 renamed the 108 live products whose names were raw QuickBooks descriptions (carton dims/weight in the name) in Erply, Woo and Supabase; pack specs deliberately left as they were, several are questionable
type: project
---

The 108 SKUs in `data/broken-product-names-20261006.csv` had raw QuickBooks
descriptions as their names, e.g. `Glass Flower Vase - 30/cs - 23" x 14" x 15"
- 30lbs - 30/pk 1bx/cs cs.30`. They were renamed 2026-10-13 with
`scripts/plan-carton-name-fixes.ts`, which writes
`data/product-name-fixes-plan-carton.csv`, and then
`scripts/fix-product-names.ts --plan=... --apply`. The log is
`data/product-name-fixes-applied-carton-20261013.csv` (T642288 hit a transient Erply
"fetch failed" and was re-run with --only; all 108 done).

- **Cosmetic only.** The base was cleaned with `descriptorFromQbDesc`. The pack
  spec was copied character for character. Names with no spec kept their QB
  case count (`- 60pk/cs`), so their only pack information wasn't lost.
- **4 SKUs are Woo-only and not in Erply:** F286459-Fu, F286459-R, F287279-Pp
  and F287279-R. Only Supabase was renamed for them. Their Woo names use the
  older `SKU - name` format, so the guard skipped them and they still carry
  the carton text on Woo. The Woo webhook only handles orders, so the
  Supabase rename sticks.

**Not fixed, needs a human:**
- About 70 specs are the receiving placeholder `N/pk 1bx/cs cs.N`, with the
  whole QB case treated as one pack. The new floral papers (F2880xx/F2881xx,
  `60/pk 1bx/cs cs.60`) conflict with the confirmed paper rule, `20/pk 60bx/cs`
  pack-sold. See the PACK-SOLD note in lib/product-naming.ts.
- 10 names still have no pack spec: CM072310, F288081, F288082, F288090,
  K229581, P273839-60cm, P273863-110cm, P273863-90cm, T642212 and T642288.
- QB typos were left as written: Cirlce (F288022), Ballon (D701141), and
  "Christmas Three in Dome" (F286555, probably Tree). FD400033/FD400038 lack
  the word "Ribbon".
- **F287279-B/-Pp/-R store the product size `7x23x17` in the case_*_in
  columns.** That figure is cm and isn't the carton, and bin-capacity maths
  reads those columns.
