---
name: project-erply-sync-category-safety
description: Erply->Supabase sync (app/api/sync/route.ts) was much closer to safe than old docs implied, except for a real category-fragmentation risk found and fixed 2026-08-18
type: project
---

Re-assessed whether it's safe to point `app/api/sync/route.ts` at real Erply
credentials (still not configured in Vercel production as of this writing —
see the erply-woo-integration subagent description). The original blockers
from [[project-erply-pagination-fix]] turned out to be already resolved:

- `image_url`/`stock_qty` exclusion — already implemented via
  `syncToSupabase`'s `skipFields` option, confirmed live in
  `app/api/sync/route.ts`.
- Price mapping — `lib/erply.ts`'s `normalizeProduct` already applies the
  same 50%-wholesale-discount + quarter-rounding formula used manually all
  session (`roundToQuarterSkip75((p.price ?? p.netPrice ?? 0) *
  WHOLESALE_DISCOUNT)`).
- The "146 would-deactivate" SKUs (products active in Supabase but missing
  from Erply's active feed) — checked live 2026-08-18, **all 146 are
  already `manually_hidden`**, so a real sync deactivating them too is a
  complete no-op for customers.

**New risk found that wasn't previously documented: category
fragmentation.** `resolveCategories()` in `lib/product-sync.ts` mapped
Erply's raw `groupName` 1:1 onto Supabase categories with no consolidation.
A live preview showed a real sync today would create ~26 new categories
matching Erply's flat groups (`Tumblers`, `Pens`, `Erasers`, `Hair Bands`,
etc.) and reassign ~2,879 products away from this catalog's deliberately
consolidated categories (`Drinkware & Cups`, `Stationery & Office`,
`Accessories & Apparel`, `Beauty & Personal Care`, `Toys & Novelties`) —
silently undoing category-consolidation work from multiple sessions
(including the Plush/Bows work done earlier today).

**Fixed 2026-08-18, three parts:**

1. `lib/erply-category-aliases.ts` — new file, maps Erply's granular
   `groupName` values to this catalog's consolidated category names (e.g.
   `Tumblers`/`Ceramic Cups`/`Speaker Cups`/`Drinkware`/`Plastic Cups` all
   → `Drinkware & Cups`). Wired into `app/api/sync/route.ts`'s product
   mapping. Any groupName not in the map passes through unchanged.
2. **Category is now insert-only, never reassigned on update.** Several
   categories are deliberate manual carve-outs with no clean Erply source
   of their own (`Speakers`, `Humidifier`, `New Arrivals`, `Chairs` vs
   `Toys`, `Flower Bears`, `Gifts`, `Plate Set`) — an alias map alone can't
   protect these, since this cron runs every 30 minutes and would keep
   re-flattening them back into the broader Erply bucket on every run, not
   just once. `syncToSupabase`'s `skipFields` now accepts `'category'`
   (added to `route.ts`'s call); when skipped, `category_id` is only set
   for products that don't already exist (see the `existingSkus`-based
   check in the record-building loop) — existing products keep whatever
   category they already have, forever, regardless of what Erply says.
3. **Found and fixed a real latent bug in `resolveCategories()` itself**
   while verifying the alias map would actually work: it matched existing
   categories by `slug` only. 11 of 44 categories (exactly the ones the new
   alias map routes into — `Toys & Novelties`, `Drinkware & Cups`,
   `Stationery & Office`, `Accessories & Apparel`, `Beauty & Personal
   Care`, `Crochet`, `Crowns`, plus a few others) have a stored `slug` that
   no longer matches what their own `name` would slugify to (leftover from
   past renames, e.g. `Toys & Novelties` is stored with slug `plush-toys`
   from before the Plush category was split out). Matching by slug alone
   would find no conflict and silently INSERT A DUPLICATE row with the
   same display name but a different id — for every one of the 8
   consolidated categories the alias map targets. Fixed by looking up
   existing categories by `name` first, only falling back to the
   slug-based upsert for genuinely new names.

**Verified live, not just in theory:** re-ran a corrected preview after all
three fixes — new categories that would actually be created dropped from 26
to 2 (`Default group`, 1 product, genuinely uncategorized in Erply — fine;
`Flower Supplies` vs the existing `Floral Supplies`, added as one more
alias, now 0). `npx tsc --noEmit` clean, all 42 existing tests still pass.

**How to apply:** this makes the sync meaningfully safer than the old
"don't point this at real credentials" blanket warning implied — the
remaining `image_url`/`stock_qty`/`category` skip logic means a real sync
today would mostly just insert 1 new SKU and refresh name/price/barcode/
`is_active` on the other 2,879, without touching images, stock, or
categorization of anything already in the DB. Still needs Dragon's explicit
go-ahead before adding real `ERPLY_CLIENT_CODE`/`ERPLY_USERNAME`/
`ERPLY_PASSWORD` to Vercel's production env vars — that's the actual
enablement step, not a code change. Don't skip re-running a fresh preview
before flipping it on if much more time has passed, since Erply's live data
(and this catalog's category set) keeps changing.
