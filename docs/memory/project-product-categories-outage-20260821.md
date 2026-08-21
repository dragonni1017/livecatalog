---
name: project-product-categories-outage-20260821
description: Adding the product_categories join table (migration 0038) caused a brief live production outage -- two distinct root causes, both fixed within minutes of being caught
type: project
---

**What happened:** Added `product_categories` (migration 0038) to support a
product belonging to more than one category. Deployed, then live-tested --
the entire public catalog (homepage and every listing page) started
returning "0 products" in production. Caught and fixed within minutes via
the same live-test-immediately-after-deploy discipline this project already
follows, but it was a real, if brief, outage.

**Two distinct causes, both from the same migration:**

1. **RLS gap.** `product_categories` was created with `enable row level
   security` but zero policies. `products`/`categories` both carry a
   `Public can read ... (roles: public, qual: true)` SELECT policy that the
   public catalog's anon-key client relies on -- the new table had no
   equivalent, so the anon client got zero rows back from it, silently (no
   thrown error, just an empty result). Fixed in migration 0039 by adding
   the matching public-read policy.

2. **Ambiguous FK embed (the actual outage cause, found after fixing #1).**
   Every product query across the app used PostgREST's shorthand embed
   syntax `category:categories(...)` to pull in a product's category. Once
   `product_categories` existed (with FKs to both `products` and
   `categories`), PostgREST had *two* valid relationship paths between
   `products` and `categories` -- the direct `products.category_id` FK, and
   the new join table -- and refused to guess, returning a `PGRST201`
   "more than one relationship was found" error on literally every query
   using that shorthand. This broke the homepage, best-sellers, new-arrivals,
   product detail, admin products/price-list, and search-suggest -- i.e.
   every product-listing query in the codebase, not just the new
   category-filter code. Fixed by explicitly naming the FK:
   `category:categories!products_category_id_fkey(...)`.

**How to apply:** any future join table added between two tables that
already have a direct FK to each other (or between two tables both already
embedded via PostgREST shorthand elsewhere) needs the same treatment:
grep the whole codebase for `<other_table>(` embed shorthand and
disambiguate every hit with `!<fk_constraint_name>` *before* deploying, not
after. Also: a brand-new RLS-enabled table needs an explicit policy check
against whichever client (anon vs service-role) will actually read it --
"RLS enabled, no anon policies" is the default pattern for *admin-only*
tables in this project, but a table feeding the public catalog needs the
public-read policy mirrored from `products`/`categories`, not the default.
The general lesson already documented elsewhere in this project (verify a
bulk write by re-fetching independently, not by trusting the writer's own
log) applies here too, one level up: after any schema change, load the
actual public homepage and confirm real product counts before considering
the change done -- a clean migration apply + clean typecheck is not proof
the live site still works.

**Current state:** both fixes deployed and verified live; multi-category
support (a product under more than one category simultaneously) confirmed
working correctly after the fix. See migrations 0038/0039.
