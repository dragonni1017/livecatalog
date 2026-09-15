---
name: project-net-terms-approval-flow
description: 2026-09-15 — /admin/credit-applications can now approve/decline net-terms applications; migration 0047 NOT YET APPLIED, and the decision feeds nothing downstream
type: project
---

Approve/decline for net-terms (credit) applications was built 2026-09-15:
migration `0047_credit_application_review.sql`, `app/admin/api/credit-applications/route.ts`
(PATCH), and `app/admin/credit-applications/CreditApplicationTable.tsx`.

Two live facts that aren't in the code:

1. **Migration 0047 is not applied yet.** Confirmed against the live DB on
   2026-09-15: `credit_applications.reviewed_at does not exist`, and 4 real
   applications (Eagle Mountain Casino, Nationwide wholesale, Witchbabe
   Designs, El arte d las flores) are all sitting at `pending` — they are
   real buyers, not test rows. Until someone pastes 0047 into the Supabase
   SQL editor, the Approve/Decline buttons surface a "column does not exist"
   error. Re-check by selecting `reviewed_at` from `credit_applications` —
   it errors if 0047 hasn't run. (The scratch probe used on 2026-09-15 was
   `scripts/_probe_credit_apps.mjs`, which is gitignored via `scripts/_*.mjs`
   and so exists only on the machine it was written on.)
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
