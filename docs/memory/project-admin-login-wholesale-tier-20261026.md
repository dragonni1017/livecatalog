---
name: project-admin-login-wholesale-tier-20261026
description: 2026-10-26 — the admin login dragon@ly-usa.com had a test customer profile on the Wholesale tier (50% off retail), so it saw half price everywhere a logged-in customer is priced. Tier cleared to None (profile kept). Any staff login with a customers row gets that row's pricing
type: project
---

**What happened.** A cart test showed a $24.00 product at $12.00 for the
admin login. Customer pricing (`lib/customer-pricing.ts`
`resolveCustomerPricing`) looks the signed-in **email** up in `customers`,
whatever the account's role. `dragon@ly-usa.com` had a profile with no name or
company, created 2026-09-03, the day the price-tier feature was built
(`ccd7c16`). So it was a test record. It was assigned `wholesale`; since
[[project-retail-anchor-pricing-flip]] tiers are discounts off retail, and
Wholesale is 50%.

**Effect.** That login saw tier prices when browsing, in the cart reprice,
and on any order submitted from it. No one else was affected: none of the 10
rep logins has a `customers` row. The only other row is a real buyer on
Wholesale, set on purpose and left alone.

**Fix (2026-10-26).** The tier was set to None in Admin → Customer Profiles.
The row still exists (no tier, 0% discount), which prices the same as no row.
The delete was not done; it is the user's call.

**How to apply.**
- Prices look wrong when testing while signed in: check `customers` for the
  tester's email before suspecting pricing code.
- Previewing a tier from a staff login means giving that email a profile.
  Clear it afterwards, or test orders from it are discounted.
- Three attempts to delete the row (SQL editor twice, the admin page once)
  left it untouched: same id, `updated_at` unchanged. The admin page's delete
  needs a `confirm()` popup to be accepted first. In the Chrome window
  driven by the Claude extension that popup may be dismissed, which cancels
  the delete silently. That is unverified. The SQL editor attempts are
  unexplained, like the 0067 migration runs; see
  [[feedback-browser-state-change-blocked]]. When a change "didn't take",
  read the row back (id, `updated_at`) rather than trusting the UI list.
