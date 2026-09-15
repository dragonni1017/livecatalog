---
name: project-net-terms-approval-flow
description: 2026-09-15 — /admin/credit-applications can now approve/decline net-terms applications (0047 applied, verified live); the decision still feeds nothing downstream
type: project
---

Approve/decline for net-terms (credit) applications was built 2026-09-15:
migration `0047_credit_application_review.sql`, `app/admin/api/credit-applications/route.ts`
(PATCH), and `app/admin/credit-applications/CreditApplicationTable.tsx`.

Two live facts that aren't in the code:

1. **0047 is applied and the write path is verified.** Applied in the
   Supabase SQL editor 2026-09-15 and checked live the same day: the four
   review columns exist, the approve write (status + approved_terms +
   review_notes + reviewed_by/at) round-trips, setting status back to
   `pending` with the columns nulled works, and the `approved_terms` CHECK
   rejects a junk value. Done on a throwaway row that was then deleted —
   the 4 real applications (Eagle Mountain Casino, Nationwide wholesale,
   Witchbabe Designs, El arte d las flores) are **still all `pending` and
   are real buyers, not test rows**; approving one emails that buyer, so
   don't use them to smoke-test the screen.
2. **An approval is a record, not a switch.** Nothing downstream reads
   `status` or `approved_terms`: catalog pricing still comes from
   `customers.price_tier_code` / `discount_percent`, and the customer's
   QuickBooks terms are still keyed in by hand at order-approval time. So
   "approved for net-60" today means only "we told the buyer yes and logged
   who said it".

**Why:** the screen had existed as a read-only list since migration 0015, with
no column for who decided or on what terms — so nothing had ever moved a row
off `pending` even though applications were arriving.
**How to apply:** don't assume an approved application changes anything about
how that customer is priced or invoiced — wiring it into the QuickBooks terms
field or a `customers.payment_terms` column is still open work. Unlike order
approval, the decision is reversible (Reopen sets it back to `pending` and
clears the review columns). See [[project-admin-users-screen]] for the
neighbouring admin-screen conventions.
