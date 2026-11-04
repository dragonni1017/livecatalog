---
name: project-search-and-photo-queue-20261104
description: 2026-11-03/04 search fixes (#213 plurals + Did you mean, dropdown per-word), hidden-products-searched list (#214), Next 16.4.2 security bump (#215), photo shot list (#216), Show-after-upload (#217); zero-result events come from the DROPDOWN; 799/801 need-photo products are hidden; Cloudinary set in prod 2026-11-04
type: project
---

**Zero-result tracking fires from the search dropdown, not the results page.**
`components/catalog/SearchInput.tsx` sends `search_no_results` when
`/api/products/suggest` returns nothing while the customer types, so
half-typed terms ("p 2737") are in the data. The grid page records only
submitted `search` events. Until #213 the dropdown matched the whole phrase
on name/sku/barcode, so "floral boxes" missed "Floral Box" even though the
grid found it. Both now use `lib/search-terms.ts` (per word, plural variants
OR'd, so it can only broaden).

**First day after #213 (deployed 2026-11-03 ~18:15 UTC):** zero-result events
fell from 27.8/day (14 days before) to 3.1/day; per submitted search, 1.4 to
0.2. The 3 left were a typo that got a suggestion and two hidden SKUs. One
day of light traffic, so treat as early. Compare timestamps in UTC: the
first check used a Pacific-time cutoff against UTC `created_at` strings and
counted pre-deploy events as "after".

**"Did you mean" rules came from replaying real searches.** Words under 5
letters and changes to the first letter are not corrected; without those,
1,649 past searches gave glue->blue, sock->lock, fairy->dairy. The
vocabulary is words from visible product names (about 1,200 products), cached
per server instance for 10 minutes, loaded only on an empty search.

**Almost every product needing a photo is hidden** (799 of 801 on
2026-11-04; 760 of them in stock and priced). So storefront views can't rank
photo work: `/admin/photo-shot-list` (`lib/photo-shot-list.ts`) ranks by
upcoming holiday, then SKUs searched with no result
(`lib/hidden-search-demand.ts`), then newest arrival. A photo upload never
unhides; since #217 the Cleanup upload result offers a Show button per
still-hidden product (audited PATCH, refuses $0). Whether to show the hidden
products is still the owner's call, see
[[project-price-review-screen-20261029]].

**Hidden products customers searched for (#214):** exact SKU/barcode
zero-result searches against active hidden products; 101 products, 149
searches on 2026-11-03. Shown on `/admin/zero-results#hidden` with the
visibility toggle, plus a dashboard card. That page used `.limit(1000)` and
silently dropped older events; it now pages.

**Cloudinary is set in production as of 2026-11-04** (all three
`CLOUDINARY_*`, Production only, not Preview), and the redeploy that picked
them up was built after they were added. That corrects the 2026-10-29 note.
The live upload had not been tested end to end when this was written.

**Next.js bumped 16.3.8 -> 16.4.2 (#215)** for two critical RCE advisories
(GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr; neither feature is used here) and
a DoS. The remaining `npm audit` items are eslint/minimatch, dev-only, where
npm's only offered fix is a downgrade to eslint@4.

**Why:** these facts aren't visible from the code and each cost a wrong
turn this session (dropdown vs grid, UTC, the Cloudinary claim).
**How to apply:** when reading zero-result data, remember it's per keystroke
from the dropdown; re-check Vercel env names before claiming a setting is
live; rank photo work by the shot list, not by views.
