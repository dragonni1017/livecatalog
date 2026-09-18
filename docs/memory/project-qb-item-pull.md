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

**NOT built yet:** nothing writes `shipment_lines.proposed_name` from the
directory. The pull and the flagging exist; the auto-fill is the next step,
deliberately left until a real pull confirms the field shapes against the
live company file. See [[project-containers-20260917]] for the 68 SKUs this
is meant to unblock and [[project-receiving-phase-1]] for where the names
get used.
