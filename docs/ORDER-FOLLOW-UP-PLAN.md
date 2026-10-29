# Order follow-up — plan (2026-10-26)

**Goal:** every quote request has an owner, nobody can lose track of one,
and an unanswered request is impossible to miss on screen. **No new emails**
(decided 2026-10-26: no daily reminders or other notifications). Everything
here is in the admin and rep screens.

## Why

On 2026-10-26, 27 orders were still `new`, the oldest from 2026-06-23. 9 look
like tests by email or name (all June/August). Of the other 18, 7 are from
August, 6 from September ($50,560) and 5 from October ($4,636). No order had been converted since 2026-09-05,
and none of October's had a rep. Today an order is one email to
`SALES_ALERT_TO` plus a row in /admin/orders. Nothing records who picked it up
or reminds anyone when nobody did.

Notifications are configured in production (`TITAN_SMTP_*` and
`SALES_ALERT_*` all exist), so this is a follow-up gap, not a missing alert.
Whether each email was delivered can't be checked: the Hobby plan keeps 1 hour
of runtime logs.

## Ground rules (from reading the code)

- **Don't touch the status side effects.** `PATCH /admin/api/orders` emails
  the customer on contacted/converted/lost. On `converted` it also
  decrements stock and enqueues `qb_sync_queue`. This plan adds **no new
  statuses**, and nothing here changes what `converted` does.
- **Test orders are dismissed, not marked lost.** Marking an order lost
  emails the customer. Dismissing is a separate silent flag.
- **Order submission stays as it is.** Auto-assignment runs after the order
  is saved, as its own non-fatal update. A failure there can never lose an
  order.

## Pieces

### PR 1: migration 0069 + dismiss
(0068 is taken by `products_held_price`, 2026-10-28.)
- `order_requests` gains `assigned_at`, `first_response_at`, `dismissed_at`,
  `dismissed_reason` ('test' | 'duplicate' | 'spam') and `dismissed_by`. New
  columns on an existing table inherit its grants. Backfill
  `first_response_at = status_changed_at` where `status <> 'new'`.
- `POST /admin/api/orders/dismiss { id, reason }`. Allowed only while the
  order is `new`. No email, no stock change, no QuickBooks. Writes the audit
  log. Undo clears the three columns.
- Dismissed orders drop out of every "waiting" count, including the
  dashboard's "not yet entered in QB".

### PR 2: owner
- `assigned_rep_email` (exists since 0001, never used) becomes the owner.
  It's set from the order page: a dropdown of rep accounts (role `rep`) plus
  "Unassigned". `assigned_at` is stamped.
- **Auto-assign** right after submit, in order of preference:
  1. the rep who placed it (`rep_user_id`);
  2. the rep on this buyer's most recent order (same `customer_email`);
  3. otherwise **leave it unassigned** (decided 2026-10-29); the sales
     inbox covers it. No rotation.
- `/rep/quotes` also lists orders assigned to the signed-in rep.

### PR 3: age on screen
- `first_response_at` is stamped the first time an order leaves `new`. This
  is one extra field in the existing PATCH and doesn't change its side
  effects.
- /admin/orders: a "Waiting" age on each `new` order, amber after 1 business
  day and red after 3 business days (decided 2026-10-29). A "Needs follow-up" filter, oldest
  first, with the owner shown.
- Dashboard card: "N waiting · oldest X days · $Y", linking to the filter.


## Before building

Both checks were waived by the user on 2026-10-29 ("don't worry about the
inbox or the test orders"):

- [x] ~~Look in the sales inbox for the 2026-10-25 order email.~~ Waived.
- [x] ~~Confirm which of the 27 are tests before the first dismiss.~~ Waived.
      A read-only query on 2026-10-29 found 9 placed by staff for testing.
      Whoever dismisses picks them on screen.

Found on 2026-10-29, not yet in a PR: three real orders have a mistyped
customer email domain, so the status emails will bounce (ORD-2026-0030,
0035 and 0037). Possible follow-up: flag likely domain typos at checkout.

## Out of scope
Any new email (a daily digest was proposed and declined 2026-10-26). New
statuses (e.g. "quoted"). Changes to conversion or QuickBooks entry. SMS
(declined 2026-09-10). Customer-facing changes.
