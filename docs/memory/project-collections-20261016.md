---
name: project-collections-20261016
description: 2026-10-16 curated/seasonal collections (migration 0059 via MCP, verified): server-read only tables (no public policy BY DESIGN), live = active + Pacific-time date window, /collections/<slug>, nav via CategoryNav collections prop, admin by SKU paste, line card ?collection=
type: project
---

Collections are curated product groups ("Valentine's", "Graduation"), with
`collections` and `collection_products` added in migration 0059.

- **Server-read only, by design.** RLS is on with **no policies**, and
  everything reads through the secret-key client (like `shipments` for
  /new-arrivals). That sidesteps the "public table without a SELECT policy
  returns nothing" trap entirely. Don't add an anon read path. The e2e
  confirms the anon key reads 0 rows.
- **Live** means `is_active` and today within `[starts_on, ends_on]`
  (inclusive, null = open), using the **Los Angeles** date
  (`todayPacific`). Anything not live 404s and drops out of the menu, so
  seasons switch on and off on their own.
- **Nav:** `CategoryNav` takes an optional `collections` prop. Every page
  that renders it (home, /new-arrivals, /best-sellers, /collections/[slug])
  passes `loadLiveCollections(getAdminClient())`. A new page with the nav
  must do the same, or collections just won't show there.
- **Admin** (`/admin/collections`): products are set by pasting SKUs in
  order, with **exact-case** matching (F286606-Wt and -WT are different
  products). The save **upserts the new list first, then prunes**, so a
  failed save never empties a collection. Hidden products can stay in a
  collection, but they don't show while hidden.
- **Line card:** `?collection=<slug>` becomes an ordered SKU list (any
  status, so upcoming seasons can be printed ahead).
- Sitemap lists live collections, but it's revalidated hourly, so an ended
  collection can linger there for up to an hour.
- Not built: a homepage strip with cover images (offered, not chosen).

**Why:** buyers had only categories, New Arrivals and Best Sellers, with no
way to feature a season.
