---
name: project-qb-item-pull
description: 2026-09-18 — QuickBooks Desktop is the source of truth for NEW product info; a QBWC item pull (migration 0050) mirrors its item list so unnamed container SKUs can be named from it
type: project
---

**QuickBooks Desktop is where new products get set up by hand** (Dragon,
2026-09-18). That makes its item descriptions the best source for naming a
SKU that arrives on a container but isn't in the catalog yet — better than
the Commercial Invoice, whose text is a customs category. Compare, for the
same SKU:

- invoice: `Plush Toys Pig Style 60cm - 100% Polyester`
- QuickBooks: `Pig Weighted Paw Calm-Panion Plush - 24inch - 12/cs - 24x17x19 28lbs`

Built 2026-09-18, mirroring the customer pull exactly: migration **0050**
(`qb_item_directory` + `qb_item_pull_state` + the `item_full_query` session
kind), `buildItemFullQueryRq`/`parseItemFullQueryRs` in `lib/qbxml.ts`, an
`item_full_query` branch in `app/api/qbwc/route.ts`, the trigger route
`app/admin/api/qbwc/item-pull`, and the screen `/admin/quickbooks/items`.

Five things worth not rediscovering:

1. **`ItemQueryRq` returns a different element per item type** —
   `ItemInventoryRet`, `ItemNonInventoryRet`, `ItemServiceRet`,
   `ItemInventoryAssemblyRet`… Assuming one silently drops most of the list.
   The description moves too: `SalesDesc` on inventory items,
   `SalesOrPurchase.Desc` (or `SalesAndPurchase.Desc`) on the others. Both
   are normalised to one `sales_desc` column.
2. **A sub-item's `FullName` is `Parent:Child`** (`Backpack:F286716`). A QBD
   Item List export needed this stripped off **813 rows** before it matched
   the catalog (`scripts/fix-fullqbd-sku-prefixes.mjs`), so the pull derives
   a `sku` column once rather than leaving each consumer to rediscover it.
3. **The `progress=100` trap was already fixed and is inherited for free.**
   `moreWorkThisSession = session != null && !shouldClearPending` in
   receiveResponseXML is what keeps a paged pull's session alive; any new
   iterator pull that leaves `shouldClearPending = false` between pages gets
   it automatically. See [[project-qb-customer-matching]].
4. **Do NOT give these tables `products`-style grants.** The root CLAUDE.md
   rule about mirroring `products` grants exists for tables the public
   catalog reads with the anon key — `products` is anon-readable, so copying
   its grants here would expose QuickBooks item and pricing data to the
   storefront. Every `qb_*` table is service-role-only (0031, 0035) and the
   customer pull proves that works.
5. **Customer and item pulls never interleave.** If both are requested, the
   customer one runs first and the item one waits for a later session —
   two live QuickBooks iterators across the same round trips would collide.

**Known coverage problem, not a tooling problem:** as of the 2026-09-04 QBD
export only **2 of the 68** new SKUs on the three 2026-09-17 containers
existed in QuickBooks. The pull can only surface what's been entered, so the
screen reports both numbers — mirrored items, and how many unnamed staged
SKUs actually have a QuickBooks record — to make the difference obvious.
Also note QBD carries ~5,617 items against a ~3,000-product catalog; whether
that gap is history or genuinely missing products is unexamined.

**FIRST REAL PULL, 2026-09-22: 6,770 items** — 6,634 Inventory, 130 Service,
3 InventoryAssembly, 3 Discount; 6,587 carry a description, 1,055 are
sub-items, 73 inactive. Of the 67 blank staged SKUs, **63 are nameable from
QuickBooks** and only 4 are missing (F287760, S162786, CM072601, H424272) —
far better than the 2-of-68 the stale September 4 export suggested. The
descriptions are richer than the invoice's, carrying pack spec and carton
dims: `Pig Weighted Paw Calm-Panion Plush - 24inch - 12/cs - 24x17x19 28lbs`.

**The screen first reported 40, not 63 — this project's case-sensitivity
trap, for the THIRD time.** QuickBooks writes `FD400004-25yard` and
`P273813-45cm`; the panel upper-cased the staged SKU and compared it against
the raw `sku` column with a case-sensitive `in`, missing 23 real matches and
telling Dragon to enter 27 products when only 4 were missing. Fixed
declaratively in migration **0051** (`sku_norm` generated column) rather than
by remembering to upper-case at each call site — remembering has now failed
three times. `fetchQbItemsBySku` falls back to an in-memory scan on error
42703, so the code works either side of that migration.

**Auto-fill shipped** as `PUT /admin/api/qbwc/item-pull`, with the matching
in one place (`lib/qb-item-directory.ts`) so the count on screen and the
write can't disagree. It writes only `proposed_name`: category and price are
the other two things `missingForCreate()` wants, and neither is inferable
here (a QuickBooks income account is not a catalog category, and pricing is
a decided manual Erply step). Ambiguity is a refusal — 40 SKUs in the real
pull have both a bare item and a `Backpack:`-prefixed sub-item, and naming
from the wrong record is worse than leaving a blank. Updates target line
ids, never an `ilike` on the SKU, because `_` and `%` are LIKE wildcards
that would quietly rename other rows. See [[project-containers-20260917]] for the 68 SKUs this
is meant to unblock and [[project-receiving-phase-1]] for where the names
get used.

## The case pack is the cross-check that stops a confidently wrong name

Caught 2026-09-22, before the first fill ever ran. Matching on SKU equality
alone was about to name a box of artificial flowers **"White Heart Triple Set
Fuzzy"**.

Container EGSU1396926 ships F287759 as 1,800 pieces in 15 cartons = **120/cs**.
QuickBooks holds two records whose SKU starts F287759:

| record | pack | description |
|---|---|---|
| `F287759` | 24/cs | White Heart Triple Set Fuzzy |
| `F287759-FLOWER` | **120/cs** | Chenille Stems Gerbera Daisies |

The bare SKU is an exact match and the wrong product. Three independent
sources agree the container's F287759 is the flower: the packing list's
120/cs, the `-FLOWER` record's 120/cs, and the Commercial Invoice listing
F287759 in its 7-row "Artificial Flowers Braided … Single Style" group at
15ctn/1800pcs. F287760 is the same story and had been reported *missing*
while QuickBooks held `F287760- Pk` and `F287760- FLOWER`.

So `resolveSku` now takes the line's `pieces_per_case` and parses the
`N/cs` out of the QuickBooks description:

- exact match, packs **agree** → fill (`basis: 'exact+pack'`)
- exact match, description quotes **no** pack → fill (`basis: 'exact'`) —
  nothing to contradict it
- exact match, packs **conflict** → `pack_mismatch`, fill nothing, and hand
  back any better candidate for the screen to offer
- **no** exact match but exactly one suffixed variant agrees on pack →
  fill (`basis: 'variant+pack'`); two independent keys is stronger evidence
  than the exact-SKU-only matches already trusted
- pack also breaks an otherwise ambiguous duplicate

Live result on the 67: 63 nameable (44 exact+pack, 18 exact-only, 1
variant+pack), 1 `pack_mismatch` (F287759), 0 ambiguous, 3 genuinely missing
(**S162786, CM072601, H424272** — F287760 is no longer among them).

**Read this before trusting any SKU-equality match against QuickBooks on this
account.** Suffixed variants carrying entirely different products under one
base SKU are normal here — see [[project-suffix-barcode-collisions]] for the
same shape of problem in barcodes.
