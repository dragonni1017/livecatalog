---
name: project-display-settings-rls-gap
description: 2026-08-14 -- display_settings table had RLS enabled with zero policies, silently no-op'ing every /admin/display-settings toggle for real site visitors since migration 0017; fixed with a public SELECT policy (migration 0022); price-visibility toggle (show_price_listing/detail) added same session
type: project
---

While adding a new "hide price" toggle to `/admin/display-settings`
(dev-server smoke test, not a production incident report), discovered
the entire `display_settings` feature had been non-functional for real
site visitors since it shipped (migration 0017).

**Root cause:** `display_settings` has RLS enabled (`relrowsecurity =
true`) but had **zero policies** — unlike `products`/`categories`, which
also have RLS enabled but pair it with an explicit `"Public can read
<table>"` SELECT policy for the `public` role. With RLS on and no
policy, every anon (site-visitor) query against `display_settings`
silently returns 0 rows — not an error, just nothing. `lib/display-
settings.ts`'s `getDisplaySettings()` treats a missing row as "table not
migrated yet" and falls back to `DEFAULT_DISPLAY_SETTINGS` (everything
`true`). So every toggle on that admin page — stock badge, SKU/barcode,
category label, pack info, and now price — has always silently shown as
"on" to real visitors regardless of what the admin page said, since
Aug 10 (when 0017 shipped). The original migration's own comment ("No
RLS — matches products/categories") was aspirational and wrong; the
actual products/categories pattern is RLS-enabled + a public policy, not
RLS-disabled.

**Confirmed via direct Supabase queries** (`pg_class.relrowsecurity`,
`pg_policies`), not guessed — `display_settings` had 0 rows in
`pg_policies`, `products`/`categories` each had exactly one SELECT
policy for role `public`.

**Fixed same session:** `supabase/migrations/0022_display_settings_
public_read_policy.sql` adds `CREATE POLICY "Public can read
display_settings" ON display_settings FOR SELECT TO public USING
(true);` — applied live via Supabase MCP with Dragon's go-ahead.
Verified via dev server + curl + screenshot: toggling
`show_price_listing`/`show_price_detail` off/on now actually changes
what the homepage grid and product detail page render.

**How to apply:** if any *other* new Supabase table is added that the
public catalog needs to read (not just `display_settings`), don't assume
"RLS disabled by default" — check `pg_class.relrowsecurity` and
`pg_policies` for it explicitly, the way `products`/`categories` actually
work, not the way an old migration comment claims they work. A table
with RLS on and no policy fails silent (empty result, not an error),
which is exactly why this sat unnoticed for days.

**Unrelated feature added same session:** `show_price_listing` /
`show_price_detail` columns (migration 0021) let admin hide price display
site-wide or just on product-detail pages, independent of cart/order
logic (AddToCartButton still receives the real price even when hidden).
