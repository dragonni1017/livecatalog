---
name: project-sales-tax-20261019
description: 2026-10-19: estimated sales tax by ship-to state (0066, lib/sales-tax.ts): app ESTIMATES only, QuickBooks charges the real tax and is never sent a tax line; rate table empty until the tax owner fills it
type: project
---

Plan and status: `docs/SALES-TAX-PLAN.md`. Phases 1 and 2 built; migration
0066 applied via the Supabase MCP (user asked) and checked through the app key.

- **Estimate only.** QuickBooks Desktop applies each QB customer's own tax
  code to the sales orders the Web Connector sends, so a tax line from the
  app would charge twice. The estimate goes in the QB memo as text only.
- **Off until configured.** `sales_tax_states` started empty; a state with
  no active row saves `tax_exempt_reason = 'not_collected'` and shows nothing.
- **Certificates:** exempt only for the buyer signed in as the order email,
  or a rep pricing for that customer. Never a guest's typed email.
- The cart calls `/api/cart/tax-estimate` (public; subtotal from the client
  is fine for a preview). `/api/orders` recomputes and saves the snapshot in
  the same post-insert update as the promo fields.
- Live e2e uses a temporary **PR** rate tagged `updated_by = 'e2e'`, removed
  in `finally` and in the start-of-run sweep; skipped if PR has a real rate.

**Why:** owner asked for tax on quotes; rates/nexus are someone else's call
([[user-cannot-set-prices]] applies to tax rates too).
**How to apply:** never send tax amounts or tax items to QuickBooks without
a new decision (phase 3, `CustomerMod` exemption, needs asking first).
