---
name: project-rep-dashboard-20261016
description: 2026-10-16 rep attribution rule (lib/rep-attribution.ts) shared by /admin/reps and the new /rep/quotes; placed_by_rep email > rep_user_id > unlinked legacy name; reps can only OPEN orders they placed signed-in (order-access unchanged)
type: project
---

An order records a rep in two places. `placed_by_rep` is the checkout
dropdown or a `?rep=` link (a rep account email, but free text on orders from
before the dropdown). `rep_user_id` is set when a signed-in rep placed it.
**Credit rule** (`attributeOrder`): the account whose email matches
`placed_by_rep`, else the `rep_user_id` account, else an "unlinked" legacy
name. On 2026-10-16 all 4 orders with both fields agreed.

- `/admin/reps` (rebuilt) has one row per rep **account** (paged
  `loadRepAccounts`; the old page grouped raw strings, splitting people) and
  30/90/365/all ranges. It shows quote value, **open** value (new +
  contacted), converted, rate and last quote. Unlinked legacy names are in
  their own table.
- `/rep/quotes` (new, linked from /rep) shows a rep's own credited quotes,
  with this-month (PT), open, converted and all-time totals. It uses the
  same rule, so the two pages always agree.
- **Order links:** a rep can open `/order/<ref>` only when `rep_user_id` is
  theirs (`lib/order-access.ts`, the 10-01 audit fix). `/rep/quotes` links
  only those, and shows the essentials for the rest. Widening order-access to
  `placed_by_rep` would be its own decision. It was NOT changed.
- Data on 2026-10-16: 34 orders, 13 naming a rep (9 credited + 4 unlinked:
  Alina, Joann, Cong, Sonya Barfield). "Cong" is probably conglai@ but isn't
  auto-merged. janetgarcia@ had 3 open quotes worth $42,641. Verified by
  running the real code over live data (read-only), with no test orders
  inserted (they'd hit the QB queue and dashboards).
