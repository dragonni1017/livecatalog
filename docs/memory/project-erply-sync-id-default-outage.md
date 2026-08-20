---
name: project-erply-sync-id-default-outage
description: 2026-08-20 -- the daily Erply->Supabase product sync had been silently failing on every single row since at least 2026-08-05 (products.id had no default, breaking every upsert's NOT NULL check before ON CONFLICT could apply) -- the fix was already written in migration 0020 but never applied; applied now, full sync confirmed working, all prices re-verified correct
type: project
---

**The entire daily Erply→Supabase product sync (`/api/sync`, cron
`0 8 * * *` per `vercel.json`) had been a complete no-op for at least 15
days** — every product's price/name/description/active-status has been
frozen since whatever the last successful write was, while the cron kept
returning `200 ok:true` the whole time, so nothing ever alerted anyone.

**How this was found:** Dragon asked to "double check all product prices
are correct on the app." A price-only spot check found 150/1004 active
products with stale prices (25–50¢ off, all in clean quarter-rounding
increments). Digging into *why* revealed the real scope: `date(updated_at)`
across the whole `products` table showed 2,902 of 3,028 rows frozen at
exactly `2026-08-06`, with no cluster of daily touches since — meaning the
150 "wrong" prices were just the subset whose *Erply* retail price
happened to change during the outage window; the other ~2,750 "correct"
prices were equally stale, just coincidentally unchanged upstream.

**Root cause — already diagnosed and fixed in the repo, just never
applied:** `supabase/migrations/0020_products_id_default.sql` (written
2026-08-05, confirmed live at the time) explains it precisely:
`products.id` is `text primary key` with **no default value** (it
predates the migrations folder — hand-assigned during a one-time import).
`lib/product-sync.ts`'s `syncToSupabase()` never supplies `id` in its
upsert payload, assuming Postgres would either not need it (update path)
or generate one (insert path). But **Postgres builds the full candidate
row and checks NOT NULL constraints *before* `ON CONFLICT DO UPDATE`
decides whether to actually insert or update** — so every single upsert
call, whether it would've been a genuine insert *or* a plain update to an
existing row, failed with `null value in column "id" ... violates not-null
constraint`. Confirmed by directly triggering `/api/sync` locally
(authenticated via the real `CRON_SECRET` from `.env.local`, hitting live
Supabase): all 2,880 rows failed with this exact error, `skipped: 2880`.

Checked `information_schema.columns` and confirmed `column_default` was
genuinely `null` on production — migration 0020 existed as a file in the
repo but had never actually been run against the live Supabase project
(this project has no migration runner; every migration is manual, and this
one was apparently written, documented thoroughly, and then never pasted
into the SQL editor).

**Why some things looked "synced" despite this:** the manual pricing-flip
scripts from 2026-08-04/08-06 (`rebase-prices-to-retail.mjs`,
`update-prices-from-qb.mjs`, etc. — see
[[project-retail-anchor-pricing-flip]]) use plain `.update()` calls scoped
to known ids/skus, not `syncToSupabase()`'s upsert-without-id pattern — a
bare `UPDATE` never needs to satisfy NOT NULL on unrelated columns the way
an `INSERT ... ON CONFLICT` candidate row does, so those writes always
worked fine and are why `updated_at` shows 2026-08-06 instead of something
even older.

**Fixed 2026-08-20:** applied migration 0020 for real via Supabase MCP
(`alter table products alter column id set default (...)`, continuing the
existing `prod-NNNNN` zero-padded convention with a real sequence).
Confirmed the default took effect via `information_schema.columns`, then
re-triggered `/api/sync` the same way — this time `inserted: 1, updated:
2879, deactivated: 0, errors: 0`. Re-ran the full price-verification pass
(`scripts/verify-app-prices-vs-erply.mjs`, new — reuses the real
`getErplyProducts()` sync logic rather than re-deriving the price formula,
unlike the older stale `scripts/_verify_wholesale_sync.mjs`): **1,005/1,005
active products now match live Erply exactly.**

**No application code changed** — `lib/product-sync.ts`/`lib/erply.ts`/
`app/api/sync/route.ts` were all already correct; this was purely a
missing database default. The daily cron should now work correctly on its
next scheduled run without any further action, *assuming Vercel's Cron
Jobs feature is actually invoking the endpoint at all* — see the separate,
still-open concern below.

**Still open / worth checking separately:** while investigating, Vercel's
own runtime logs showed **zero requests to `/api/sync` in the past 7
days** — not errors, just no invocations at all. This is a distinct
concern from the id-default bug (which explains why the sync *failed* when
called, not why it might not be getting *called*). Not yet resolved —
worth checking Vercel dashboard → Project → Settings → Cron Jobs to
confirm the cron is actually registered/enabled for this project, since
that's not something visible via the MCP tools used here. If the cron
truly isn't firing, the 0020 fix alone won't prevent this exact kind of
staleness from recurring — it just means a *manually triggered* sync now
works correctly.

**How to apply:** if catalog data (price, name, description, active
status — NOT stock/images, which are deliberately excluded via
`skipFields`) ever looks stale again, first check whether `/api/sync` is
actually being invoked (Vercel runtime logs, `group_by: "route"`) before
assuming a code bug — this exact failure mode (silently-failing upsert
returning `200 ok:true`) produces no errors and no alerts, so staleness is
the only visible symptom. `scripts/verify-app-prices-vs-erply.mjs` is the
tool to re-check price accuracy specifically; it's safe to re-run anytime
(read-only).
