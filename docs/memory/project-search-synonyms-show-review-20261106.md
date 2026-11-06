---
name: project-search-synonyms-show-review-20261106
description: 2026-11-06 #229 WooCommerce export sends full category paths (bare names create duplicates); #231 search synonyms + category-name matching (32 dead-end terms fixed, 0 regressions); #232 product PATCH now audited (it logged nothing but deletes) + "Show these?" screen with audit-row decisions
type: project
---

**WooCommerce category paths (#229).** WooCommerce's CSV importer reads each
`A > B` from the top, so a bare `Papers` means a new TOP-LEVEL "Papers" (the
real one is `Florals/Gifts > Papers`). Even exact names would have made
duplicates. `lib/woo-categories.ts` maps all 43 catalog categories to
ly-usa.com's 61 (checked 2026-11-06; 4 marked guess: Speakers, Humidifier,
Plate Set, Signs/Animals). Static because WooCommerce isn't configured in
production; re-check with `data/woo-cat-compare.mts`. An unmapped category
leaves the product out of the file rather than sending a blank cell.

**Search synonyms + category words (#231).** `SEARCH_SYNONYMS` in
lib/search-terms.ts (journal/memo -> notebook, pipecleaner -> chenille,
stuffed/animal -> plush, skincare -> beauty, squishy misspellings, a few
Spanish words), and `categoryIdsFor`: a 4+ letter word matching a category
name also matches that category's products (`category_id.in.(...)`), which
is what "stationary" (14 searches) and "floral supplies" needed. Replay:
32 of 327 dead-end terms fixed (81 searches), 0 regressions. Brand and
character names (Hello Kitty, Pokemon, Labubu, Jellycat) are left out on
purpose. Category matching uses the primary category_id only. Synonym-handled
words are "known" to Did you mean, so tests expecting a correction for them
had to change.

**Product edits were never audited (#232).** `PATCH /admin/api/products`
logged only deletes until 2026-11-06, so Show/Hidden clicks (#214, #217) and
inline name/description/price edits before then have no audit row, despite
#214/#217 saying otherwise. It now logs `product_visibility_changed`
(hidden/shown) and `product_updated` (old/new JSON) after a successful
write (lib/product-audit.ts). Before claiming a route is audited, grep it for
logAudit / audit_log.

**"Show these?" (/admin/show-review, #232).** Hidden products whose only gap
is "hidden on purpose" in the WooCommerce export's readiness rule: 60 on
2026-11-06, all in stock and searched for. Show = the PATCH above (refuses
$0); Keep hidden / Put back are audit rows `show_review_kept_hidden` /
`show_review_reopened` via POST /admin/api/show-review, latest wins, no table.

**Next.Js route files** may only export handlers and config (`dynamic`):
shared loaders and constants go in lib/ (hit twice: woo-export, show-review).

**Why:** each is a non-obvious rule or a correction of something earlier
notes and PRs got wrong.
**How to apply:** send full category paths to WooCommerce; add a synonym only
for a term that real searches show and the catalog spells differently;
verify audit logging in the code, not from memory.
