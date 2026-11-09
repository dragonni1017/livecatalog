---
name: project-storefront-browse-owner-questions-20261106
description: 2026-11-06 #234 owner questions screen (0073, answers in-app, renames queued to Name review); #235 grouped category menu (8 departments, counts, empties hidden); #236 ?dept= pages + filter chips; #237 related products ranked; breadcrumbs show the department
type: project
---

**Owner questions (#234, migration 0073).** `/admin/owner-questions` holds
what used to be the owner workbook's QuickBooks-fix, pack-question and
photo-proofread tabs (42 loaded 2026-11-06 by
`scripts/load-owner-questions.ts`; case-count questions stay on
/admin/case-count-review). Every action writes an audit row first. "Send to
Name review" only queues a `name_review_items` row (batch `owner-questions`);
the rename happens on Name review with its pack-spec guard. Open questions
show on the Waiting page for the Owner.

**Departments (#235).** `lib/category-groups.ts` maps the 43 categories into
8 departments (Florals & Gifts, Toys, Accessories & Beauty, Drinkware,
Stationery & Office, LED & Electronics, Home & Decor, Seasonal); an unlisted
category lands in "More". The sidebar and phone menu hide empty categories
and show counts from `lib/category-counts.ts`: visible products through
`product_categories` (what `?category=` filters on), cached 10 min per
instance, menu without numbers on failure. Change a grouping by editing
DEPARTMENTS only.

**Department pages (#236).** `?dept=<slug>` (`departmentSlug`) filters on the
primary `category_id`, NOT a product-id list: for all 8 departments that
matched the membership counts exactly (2026-11-06), and the membership rows
for Florals & Gifts alone hit the 1,000-row cap, so an id list would be both
too long and truncated. A category and a department are alternatives;
`catalogHref` lets a category win. Every catalog link (pagination, price
form, chips) goes through `lib/catalog-url.ts`; add a new filter there, and
to `filterChips`, or links will drop it.

**Related products (#237).** "More in this category" was the first 6 by
name, identical on every page in a category (Plush: 4 of 6 out of stock).
`lib/related-products.ts` ranks shared name words (cap 3, x3), in stock (+4,
so stock beats one shared word), photo (+1), hash tie-break per product.
Plush out-of-stock picks ~352/528 -> 7/528. "Customers also ordered" was
already real co-orders.

**Breadcrumbs.** The product page's existing "All Products / Category"
(shown when `show_category_detail` is on) now includes the department
link when it has more than one category.

**Not verified by clicking.** The Chrome extension has been disconnected,
so the menu toggles, phone Categories panel and chips were checked by
rendering HTML (local dev + the Vercel preview), not by interaction.

**Why:** the rules above (dept filter on category_id, one URL builder) are
easy to break without knowing why they're there.
**How to apply:** edit DEPARTMENTS for menu changes; route new catalog
filters through lib/catalog-url.ts; re-check the dept-count equality if
products start relying on product_categories without a primary category_id.

**Phone quote bar (#239, 2026-11-09).** components/catalog/MobileQuoteBar.tsx:
below sm, once the quote has items, a bar pinned to the bottom of browsing
pages (showsQuoteBar allow-list: home, product, new-arrivals, best-sellers,
collections, category, favorites; never cart/order/account/forms). Count
only: the cart context subtotal uses prices saved at add time and the quote
page can reprice (tiers, volume), so a total could disagree. Adding a price
means using the quote page's pricing first.

**Home tiles + recently viewed (#240).** "Shop by department" tiles on the
plain landing view only (same rule as the collection strip); photo = the
department's in-stock product with a real photo and the most stock
(departmentPhotos), cached 10 min (lib/department-tiles.ts). Recently viewed
lives in the visitor's own localStorage (recently_viewed_v1, max 12, name +
photo, no price), read via useSyncExternalStore so the server render is
empty; the lint rule react-hooks/set-state-in-effect forbids the
useEffect+setState version.

**Search check 2026-11-09.** Empty per submitted search: 1.40 before any
fix, 0.44 after #213, 1.09 after #231, but the rise was ONE 4-minute session
searching 16 SKUs that are all hidden or not in the catalog (~2.7 empty/day
without it, from 27.8). Typing "f 288022" with a space is fine. Added seda ->
tissue, plato -> plate. Recurring harmless suggestion: contact -> compact.

**CI lessons (#239, #240).** A run that fails in under a minute with "likely
failed because of a workflow file issue" and no jobs is a GitHub startup
glitch: re-run it. And run tsc AFTER writing test files: vitest doesn't
typecheck, so a test-only type error passes npm test locally and fails CI.
