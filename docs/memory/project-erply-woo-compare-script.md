---
name: project-erply-woo-compare-script
description: New scripts/compare-erply-woo.mjs (2026-08-03) diffs Erply vs WooCommerce directly by SKU, separate from the Erply-vs-Supabase checks
type: project
---

Added 2026-08-03 in response to a request to check differences between Erply
and WooCommerce ahead of ever syncing one to the other. This is a different
comparison than the existing Erply<->Supabase checks
(`scripts/check-erply-woo-health.mjs`, `list-erply-deactivate-candidates.mjs`,
`match-deactivate-candidates.mjs`) — those diff Erply against *this repo's*
`products` table. `compare-erply-woo.mjs` diffs Erply directly against
WooCommerce (ly-usa.com), which is what actually surfaces the "172 unmapped
Woo products" class of issue referenced in
[[project-erply-image-backfill]] — that number came from the separate
Erply->WooCommerce integration (not in this repo), and had never been
re-derivable from inside livecatalog until this script existed.

Requires new env vars in `.env.local`, none of which existed before: `WOO_STORE_URL`,
`WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET` (WooCommerce REST API v3 read-only
key), alongside the existing `ERPLY_CLIENT_CODE`/`USERNAME`/`PASSWORD`.

**Run 2026-08-03, confirmed against live data:** 2,870 active Erply products,
every one matched by SKU to a WooCommerce product (0 in `erply-only.csv`, 0
price/stock mismatches). WooCommerce has 3,042 products total (all
non-trash statuses) — exactly 172 more than Erply, and those 172 are the
historical "unmapped Woo products" number: all sitting as **drafts**, all
created in a single batch on 2026-07-23T18:33:37, and confirmed **none of
their SKUs exist in Erply's active feed at all** (not a status-only gap —
genuinely absent from Erply). List: `data/erply-woo-review/woo-only.csv`.

Also note: `status=publish` alone silently misses this entire class of
problem (first run of this script used it and reported a false "perfect
match"). WooCommerce's REST API also rejects a comma-separated `status` list
(`rest_invalid_param`) — `status=any` is the value that works and already
excludes `trash`.

Erply's API turned out to be reachable from this sandbox during this session
(2,870 products fetched successfully) — contradicts the assumption in
[[project-erply-image-backfill]] and `check-erply-woo-health.mjs`'s header
comment that Erply's domain "isn't network-allowlisted" there. Don't assume
either way; the safer read is that reachability may vary by environment, not
that the old note was simply wrong.

**Field-level diff, added same session:** extended the script to compare
name, price, stock, category, description, and image-presence for every
matched SKU (not just price/stock). Getting a clean signal took several
rounds of ruling out false positives from encoding, not real drift — worth
reading before re-trusting raw field-mismatch counts:
- `name`/`description`: WordPress stores/returns text with HTML entities and
  "texturized" typography (straight quotes -> curly quotes/primes, "-"
  between numbers -> en dash, "x" between dimensions -> "×", "..." -> "…"),
  none of which is real content drift vs Erply's plain text. `stripHtml()`
  decodes entities and normalizes typography back to ASCII on **both**
  sides — an earlier version only normalized Woo's side and produced a false
  `name` mismatch on Erply's own raw en-dash character (SKU P273623). Also:
  this store's integration writes Erply's description into Woo's
  `short_description` field, not `description` (which is empty on every
  product) -- comparing against the wrong field is what produced the first
  "2870/2870 descriptions differ" false alarm.
- After all that: **0 name mismatches, 2 real description mismatches**
  (genuine minor copy edits made on the Woo side, not a sync bug).
- **`category`: 2,870/2,870 mismatch, and this one is real.** Every
  WooCommerce product sits in category "Uncategorized" regardless of
  Erply's `groupName` (e.g. Erply "Candy" -> Woo "Uncategorized" for every
  candy SKU). The integration is not syncing/mapping category at all.
- **`hasImage`: 1,903 mismatch, all in the direction Erply=false / Woo=true**
  — expected, not a sync failure: Erply's image API is gated account-wide
  (see [[project-erply-image-backfill]]), so Erply legitimately returns no
  image data to sync from; Woo's images come from wherever the integration
  originally sourced them, independent of Erply.
- **Bottom line for "which fields shouldn't be differing": category is the
  one real, fixable sync gap.** Price, stock, and name are already in sync;
  the image gap is an Erply-side limitation, not a integration bug.

**Why:** the Erply->WooCommerce integration's product-sync problems (unmapped
Woo products, broken images on Woo) were previously only knowable via a
separate, undocumented investigation outside this repo. Re-deriving them from
livecatalog closes the same "silent drift" gap that
[[project-erply-woo-proactivity-setup]] closed for the Erply<->Supabase side.

**How to apply:** run `node scripts/compare-erply-woo.mjs` once the three
`WOO_*` env vars are set (worked fine from this sandbox 2026-08-03; try
locally first if it can't reach Erply's API in a future environment). All 172
Woo-only products found this run were `type: 'simple'`, so the known
variable-product/variation-SKU limitation in the script header didn't
actually bite this time — but it's still real and untested, so don't assume
it stays irrelevant if the 172 changes shape later. Next decision point:
publish the 172 as real Erply-backed products (need to create them in Erply
first, same flat-vs-matrix-variant question as [[project-erply-pagination-fix]]'s
143), or leave them as abandoned drafts if they were a one-off import mistake
from 2026-07-23 — worth asking whoever ran that import before doing either.
