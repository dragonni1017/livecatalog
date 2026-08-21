---
name: project-customers-table-never-applied
description: 2026-08-21 -- customers table (migration 0012) was written but never run; buyer-file discounts silently never applied to any order since the feature shipped. Applied live + RLS added (0036), verified working.
type: project
---

`app/api/orders/route.ts`'s customer-discount lookup and
`app/admin/orders/[id]/page.tsx`'s "Buyer Discount on File" section, plus
the full `/admin/customers` (Customer Profiles) admin UI and its API route
(`app/admin/api/customers/route.ts`), were all built against a `customers`
table that **did not exist in the live database** — `supabase/migrations/
0012_customers.sql` was written but never pasted into the Supabase SQL
editor. Every one of those code paths already guarded against this (try/
catch with a console.warn, or a `.maybeSingle()` that just returns null),
so nothing crashed — the discount feature just silently never worked, and
`/admin/customers` silently showed "No customer profiles yet" forever.

**Why:** same class of bug as [[project-erply-sync-id-default-outage]] and
[[project-display-settings-rls-gap]] — a migration file existing in the
repo is not the same as it having been run. Found while doing a general
"what else needs improving" pass, not because anything visibly broke.

**Fixed 2026-08-21**: applied `0012_customers.sql` verbatim, plus a new
`0036_customers_rls.sql` enabling RLS with no policies (0012 didn't
include this — every other table in this schema does; all access already
goes through `getAdminClient()` so this is defense-in-depth, not fixing an
active hole). Verified live: created a real customer profile (15% discount)
for a real order-placing email, confirmed the "Buyer Discount on File"
banner rendered correctly with the right discounted subtotal on that
order's admin detail page, then deleted the test profile.

**How to apply:** if a future "why isn't X working" investigation turns up
a table/function that's referenced in code but behaves as if empty/absent,
check whether its migration file exists in `supabase/migrations/` but was
never actually applied — `information_schema.tables`/`pg_proc` via the
Supabase MCP `execute_sql` tool settles it in one query, faster than
debugging the application code that's already correct.
