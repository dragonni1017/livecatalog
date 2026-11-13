---
name: project-price-file-pass-sold-out-hides-20261110
description: 2026-11-10: a Claude session outside this repo's data/ folder held 197 prices from LIVE_price_review_simple.xlsx (61 reverted, 33 re-set per piece; live matches the audit), so 388 held prices now wait on Erply; 77 products hidden as sold out per the file's notes, and all 77 now show up on "Show these?"; batch 49 applied (936 left, Show these? 253); admin still unused
type: project
---

**Second price-file pass, 2026-11-10 (12:22-15:35 PT).** It was run by a
Claude session that left **no files in this repo's `data/`** and made no
commits. Only `audit_log` (action `product_price_held`) records it, so read
that table, not git or `data/`, to reconstruct the pass. It touched 197
products:
- `claude-price-review-2026-11-10`: 197 prices held.
- `claude-price-review-revert-2026-11-10`: 61 of them reverted minutes later.
- `claude-per-piece-match-2026-11-10` (13) and
  `claude-per-piece-smallest-unit-2026-11-10` (20) then re-set 33 of the
  reverted ones on a per-piece basis.
- Net against the morning: 131 up, 38 down, 28 back where they started.
  8 products went up more than 3x and 2 went down to under a third (e.g.
  H424181 $43.25 -> $3.50).
- Checked 2026-11-10: `price_cents` and `held_price_cents` equal the last
  audit value on all 197.
- **Held prices waiting on Erply: 388** (192 before). Erply's API can't set
  prices, so they wait for the price setter. See [[project-held-prices-20261028]].
- `/admin/price-review` is unchanged: batch `2026-10-29`, 82 pending, none
  decided. The user said to leave prices alone this session, since pricing is
  someone else's call.

**77 products hidden as sold out** (17:24 UTC, `product_hidden`,
performed_by `Claude Code: sold-out notes in LIVE_price_review_simple.xlsx
2026-11-10`), based on the file's notes, not stock_qty.

**Waiting page, Nov 10 vs the Nov 9 baseline** in
[[project-admin-guide-waiting-trend-20261109]]: quotes 25 -> 26 (a new
quote), QuickBooks 25 -> 26, owner questions 56 -> 67. Nothing else moved.
**The admin is still unused since Nov 4.**

**The 77 sold-out products landed on "Show these?"** They have a photo, a
price, a category and a description, and `manually_hidden` is the only thing
missing, which is exactly that screen's rule (`app/admin/show-review/page.tsx`).
39 of them have stock 0. Nothing on the screen says why they were hidden, so
a "Show" click puts a sold-out item back on the storefront. Any future bulk
hide of complete products has the same effect. Open question for the user:
write `show_review_kept_hidden` rows for them, or have the screen skip them.

**Description batch 49 applied 2026-11-10** (built 2026-11-09, files
`data/description-batch-49-*`, log + undo written, read back 32/32). All 32
had a name-copy description (`isNameCopyDescription`), which counts as
missing. Every description was checked against its photo. D701107 was
reworded from "Pack of 3" to "3 to a bag", because the product sells 12/pk.
Afterwards: **936** hidden products are missing only a description, and
"Show these?" has **253** (144 + 32 described + 77 sold-out).

**Why:** the price pass happened outside the usual paper trail, so the next
session would otherwise start from the Nov 9 picture (192 held).
**How to apply:** before any price or visibility work, count
`held_price_cents is not null` and read today's `audit_log`. Don't assume
`data/` or git shows everything that changed in live data.

**Update 2026-11-13.** The sold-out question is settled: "Show these?" now
skips sold-out hides while stock is 0 (#253). The 12 rows the 11-10 per-piece
pass re-set (e.g. PF20200931 $60, P273658 $29) were later overwritten by the
user's 2026-11-12 decision to apply every sheet price as typed × 2.4. See
[[project-price-sheet-base-20261112]]. Held prices: 389.
