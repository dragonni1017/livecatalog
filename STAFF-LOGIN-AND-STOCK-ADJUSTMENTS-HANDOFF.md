# Handoff: Staff Logins + Manual Stock Adjustments

**Status:** Implemented. Migration applied directly to Supabase (project `aguorduaxfqrvvywgrdi`) via MCP — no manual SQL step needed.

## What changed

1. **`/admin` login is now real per-person accounts (Supabase Auth)**, not the old shared `ADMIN_PASSWORD` cookie. Each signed-in person's email is attached to everything they do.
2. **Manual stock adjustments**: on `/admin/products`, every product has a stock button (`123 in stock`) that opens a modal to add or remove units, with an optional reason, and shows a history of past adjustments for that product.

## How to create a staff account

There's no sign-up page on purpose — only an admin can create accounts:

1. Open the Supabase Dashboard → project `dragonni1017's Project` → **Authentication → Users**.
2. Click **Add user → Create new user**.
3. Enter their email + a temporary password, and check **Auto Confirm User** (so they don't need to click an email link).
4. Give them the email + temp password; they can change it later from Supabase's password-reset flow if you wire one up, or you can just reset it for them in the same screen.

Anyone with an account can sign in at `/admin/login` and reach all of `/admin/*` — there are no roles/permissions tiers yet (everyone with an account has full admin access, same as the old shared password did).

## How login works now

- `middleware.ts` checks for a valid Supabase Auth session cookie on every `/admin/*` request and redirects to `/admin/login` if missing/expired.
- `/admin/login` is a normal email + password form (`app/admin/login/page.tsx`) using the browser Supabase client (`lib/supabase-browser.ts`) — `supabase.auth.signInWithPassword()`. The session is stored in cookies (not localStorage) so the server can read it too.
- Sign out is the button in the dashboard header (`components/admin/SignOutButton.tsx`) — calls `supabase.auth.signOut()`.
- `lib/supabase-server.ts` exports `getServerSupabaseClient()` for Route Handlers/Server Components that need to know *who* is signed in (used by the dashboard header and the stock API route).

## How stock adjustments work

- UI: `components/admin/StockAdjuster.tsx`, wired into `app/admin/products/page.tsx`.
- API: `app/admin/api/stock/route.ts`
  - `POST { product_id, delta, reason? }` — applies a signed integer delta to `products.stock_qty`. Rejects the request if it would push stock below 0. Requires a valid session (401 otherwise). Logs the change to `stock_adjustments` and best-effort re-runs the existing low-stock email check (`lib/low-stock-alert.ts`) in case the adjustment crosses the reorder threshold.
  - `GET ?product_id=` — last 50 adjustments for that product.
- DB: `stock_adjustments` table (see `supabase/migrations/0004_stock_adjustments.sql`) — `delta`, `previous_qty`, `new_qty`, `reason`, `changed_by_email`/`changed_by_user_id`, `created_at`. RLS is on with no public policies; all reads/writes go through the service-role client server-side, same pattern as every other table in this app.

## Caveats / things to know

- **Same overwrite caveat as the existing name/description editor**: a manual stock adjustment is a between-imports override. The next Excel upload or Erply sync sets `stock_qty` from that source of truth again, wiping out manual changes. This mirrors the note already on the product edit modal.
- **No roles yet.** Every staff account can edit everything in `/admin`. If you later want e.g. read-only or stock-only accounts, that needs a `role` column (e.g. on a `profiles` table keyed to `auth.users.id`) and checks in the relevant routes — not built, since it wasn't asked for.
- **Negative stock is rejected, not clamped.** Removing more than what's on hand returns an error instead of silently going to 0 — adjust the quantity and try again (or do a recount first).
- `ADMIN_PASSWORD` env var is no longer used anywhere; `.env.example` was updated to reflect that. You can remove it from `.env.local` whenever convenient, it's just inert now.
