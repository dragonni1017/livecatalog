---
name: project-price-review-screen-20261029
description: 2026-10-29 /admin/price-review (migration 0070, #208) replaces price spreadsheets — suggested price + reason per row, Approve holds the price (audit first), Erply list CSV of all held prices; 82 rows loaded (batch 2026-10-29). Also: checkout email typo prompt (#207), Cloudinary env now set in prod
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

**Cloudinary in production.** `CLOUDINARY_*` was missing from Vercel prod
until 2026-10-29, so the /admin/cleanup photo upload had never worked live.
It is set now, but it was untested in a browser at the time of writing.

**Gotcha.** On Windows, `process.exit()` in a script with open fetch sockets
can crash Node (`UV_HANDLE_CLOSING` assertion). End scripts normally instead.
