---
name: project-price-review-screen-20261029
description: 2026-10-29 /admin/price-review (0070, #208) and /admin/name-review (0071, #211) replace the price and name spreadsheets (approve with audit first); prod env Erply set, WooCommerce and Cloudinary NOT set; checkout email typo prompt (#207); Cleanup phone-camera photo
type: project
---

**Price review screen (#208, migration 0070).** `price_review_items` holds one
row per product whose price needs a decision: `suggested_cents`, `reason`,
`grp`, `note`, and `status` (pending, approved or skipped). It is loaded from
a review sheet by `scripts/load-price-review.ts <sheet> <batch> [--apply]`,
which is a dry run by default, changes no prices and is safe to re-run.
On `/admin/price-review`:
- **Approve** writes the `audit_log` row first (`product_price_held`), then
  sets `price_cents` and `held_price_cents` together. The update is guarded
  on the price being unchanged. See [[project-held-prices-20261028]].
- Prices must be on the grid: `roundCentsToQuarterSkip75`, .00/.25/.50.
- "Download Erply list" (`/admin/api/price-review/erply`) is a CSV of every
  held price still waiting on Erply, whatever set it.

The first batch, `2026-10-29`, is the 82 undecided rows of the
LIVE_price_review_simple.xlsx check. 63 come with a suggestion, and 21 of
those say "keep": in those rows the file's per-piece price × pieces per
pack × 2.4 equals today's website price exactly, so the file was per piece,
not wrong.

**Checkout email typo prompt (#207).** `lib/email-typo.ts suggestEmailFix`
backs a "Did you mean …?" prompt under the cart email. It is a suggestion
only. `KNOWN_REAL_DOMAINS` lists real look-alikes that must never be
questioned (myyahoo.com is Yahoo's own). A sweep on 2026-10-29 found only
the three known bad orders (ORD-2026-0030, 0035, 0037).

**Production env (Vercel, names checked 2026-10-29).**
- `ERPLY_*`: **set**, so renames and syncs reach Erply from the live site.
- WooCommerce: **not set**. A rename from the site writes Erply and the
  catalog and reports Woo as "SKIPPED — WooCommerce not configured here".
  Run `scripts/fix-product-names.ts` locally to catch Woo up.
- `CLOUDINARY_*`: **not set**, so the /admin/cleanup photo upload has never
  worked live. The user believed they had added it, but the env list showed
  none, in production or preview. Re-check with the Vercel MCP
  `filter_project_envs` (names only) before telling anyone uploads work.
  On 2026-10-29 four photos went up through a local script instead
  (data/photo-upload-20261029).

**Name review screen (#211, migration 0071).** `/admin/name-review` works
like price review, but for renames. `name_review_items` is loaded by
`scripts/load-name-review.ts` from the owner workbook's "Name fixes" tab:
the 2026-10-29 batch is 120 rows, 100 with a suggestion. Rename goes through
`lib/product-name-fix.ts`, the same code as Cleanup and the script. Its
audit row is written before the rename, and a second row records the
per-system result. A row is marked renamed only once the catalog has the new
name, so a retry is safe. Pack-spec changes are refused. The first apply of
0071 didn't show up (PGRST205); a re-run plus a schema reload fixed it.

**Cleanup phone camera (2026-10-29).** "Take photo" on the Cleanup photo
drop renames the shot to a chosen SKU (SKU.jpg, then SKU-2.jpg …) before
matching. Without that, phone names like IMG_1234 match nothing. It counts
exact `SKU` / `SKU-<n>` only, because some SKUs end in a number
(P273606-2).

**Gotcha.** On Windows, `process.exit()` in a script with open fetch sockets
can crash Node (`UV_HANDLE_CLOSING` assertion). End scripts normally instead.
