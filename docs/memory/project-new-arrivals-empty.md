---
name: project-new-arrivals-empty
description: 2026-10-02 - /new-arrivals shows nothing - it filters created_at >= 30 days ago, but created_at is the import date, so 0 of 1,185 visible products qualify; NOT fixed yet
type: project
---

`app/(catalog)/new-arrivals/page.tsx` lists products with `created_at` within
the last 30 days. On 2026-10-02 **0 of 1,185 visible products** qualified,
and all 1,185 fell within 90 days. `created_at` records when a row reached
Supabase (bulk imports and syncs), not when stock physically arrived. So the
page is empty most of the time, and it fills with whatever a bulk import last
touched, not real new stock. The "Newest" catalog sort has the same
weakness.

Found while scoping catalog filters; it's why "New arrivals" wasn't added as a
filter. Not fixed.

**Why:** a real arrival date exists elsewhere. Receiving applies containers
(`shipments.applied_at`, `products.dim_source_etd` for measured cartons), but
nothing feeds it to the catalog.
**How to apply:** if fixing it, derive "arrived" from receiving
(`shipments` applied_at for the SKUs in that shipment), or add an
`arrived_at` set on first stock-in. Don't reuse `created_at`.
