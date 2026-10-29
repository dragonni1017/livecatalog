---
name: project-order-follow-up-20261029
description: 2026-10-29 order follow-up built and live (migration 0069, PRs #203-#205): silent dismiss, an owner per order (auto-assigned on submit), waiting age amber 1 / red 3 business days, Needs follow-up view + dashboard card; 7 owners backfilled, 7 staff tests dismissed
type: project
---

The plan is `docs/ORDER-FOLLOW-UP-PLAN.md`. All three parts shipped on
2026-10-29. No new emails, by decision.

**Data model (migration 0069).** `order_requests` gained `assigned_at`,
`first_response_at`, `dismissed_at`, `dismissed_reason` ('test' | 'duplicate'
| 'spam') and `dismissed_by`. The owner is the old `assigned_rep_email` (from
0001, previously unused). The live constraint is named
`order_requests_dismissed_pair_c`, not `_pair_check` as in the file (a paste
cut it; see [[feedback-sql-editor-runs-not-landing]]). Rename it before
re-running 0069.

**Rules worth knowing before touching this:**
- **Dismissed is not a status.** `lib/order-dismiss.ts` with
  `POST /admin/api/orders/dismiss`. It works only while the order is `new`
  and not entered in QuickBooks. It has no email, stock or QuickBooks effect.
  Marking an order `lost` would email the customer. Waiting means `new` and
  not dismissed (`lib/order-age.ts isWaiting`).
- **Owner.** `lib/order-owner.ts chooseAutoOwner` picks the credited rep (same
  rule as /admin/reps, `attributeOrder`), else the owner of the buyer's last
  order, else unassigned (no rotation, decided 2026-10-29). It runs after
  commit in `app/api/orders/route.ts` side effects and catches its own
  errors. Admins change the owner with `POST /admin/api/orders/owner`, which
  only accepts a real rep account. /rep/quotes lists assigned orders, but
  order-page access (`lib/order-access.ts`) is unchanged.
- **Age.** Counted in Los Angeles dates, Mon-Fri, no holidays. Amber at 1
  business day, red at 3. `first_response_at` is stamped once, in the status
  PATCH (`app/admin/api/orders/route.ts`), the first time an order leaves
  `new`. That one field is the only change to the approval route.
- **Migration before merge.** The orders list selects the new columns, so
  merging before the migration lands breaks /admin/orders.

**Live data changes, 2026-10-29** (audit rows written before applying; local
logs and undo files in `data/`):
- 7 rep-credited open orders given their credited rep as owner
  (`order-owner-backfill-20261029-*`).
- 7 staff test orders dismissed as 'test' (`order-dismiss-20261029-*`). The
  dashboard went from 27 waiting to 20. ORD-2026-0003 and 0010 (from a staff
  address) are probably tests too, but stay pending Cong's word.

**Open:** three real orders have a mistyped customer email domain
(ORD-2026-0030, 0035, 0037), so their status emails bounce. Nobody has fixed
the emails yet; a checkout typo check is a possible follow-up.
