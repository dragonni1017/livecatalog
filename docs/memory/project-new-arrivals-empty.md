---
name: project-new-arrivals-empty
description: 2026-10-02 - /new-arrivals was empty (created_at is the import date); FIXED same day to date by shipments.applied_at from receiving; the "Newest" catalog sort still uses created_at
type: project
---

`app/(catalog)/new-arrivals/page.tsx` lists products with `created_at` within
the last 30 days. On 2026-10-02 **0 of 1,185 visible products** qualified,
and all 1,185 fell within 90 days. `created_at` records when a row reached
Supabase (bulk imports and syncs), not when stock physically arrived. So the
page is empty most of the time, and it fills with whatever a bulk import last
touched, not real new stock. The "Newest" catalog sort has the same
weakness.

**FIXED 2026-10-02 (#91):** the page now lists SKUs on APPLIED shipments in
the last 30 days (`lib/new-arrivals.ts`, `latestArrivalBySku`), dated by
`shipments.applied_at` and read server-side with the admin client. It showed
18 visible products at the time. Most of the 131 received SKUs were still
hidden at $0 awaiting pricing. Arrivals before receiving went live
(2026-09-23) are unknown. The catalog's "Newest" sort still orders by
`created_at` and has the same weakness.

**Why:** a real arrival date exists elsewhere. Receiving applies containers
(`shipments.applied_at`, `products.dim_source_etd` for measured cartons), but
nothing feeds it to the catalog.
**How to apply:** if fixing it, derive "arrived" from receiving
(`shipments` applied_at for the SKUs in that shipment), or add an
`arrived_at` set on first stock-in. Don't reuse `created_at`.
