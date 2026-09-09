---
name: project-vercel-preview-live-supabase
description: 2026-09-08 Vercel Preview env vars added (previews previously failed every build) — but previews now read AND WRITE the live Supabase project
type: project
---

Vercel Preview deployments now have `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Before this,
all three were Production-scoped only, so **every** preview build failed at
`Error: supabaseUrl is required.` while collecting page data for
`/admin/api/display-settings`. PR #1 was the first PR this repo ever had, which
is why nothing had hit it before.

They were added as **separate Preview-scoped entries** rather than by editing
the Production ones — Vercel cannot convert an existing Secret to Config in
place (encrypted values are write-only, nothing to hand over), and editing
would have briefly left Production without config. The two `NEXT_PUBLIC_*`
Preview entries are type Config; `SUPABASE_SERVICE_ROLE_KEY` was added with
`--sensitive` so it stays Secret. The Production entries are untouched and
remain Secret — Vercel will keep nagging to convert them to Config; that
warning is advisory and can be ignored.

**Why:** without this, PR checks were permanently red, so a genuine build
failure would have been indistinguishable from the standing noise.

**How to apply:** previews point at the **live** Supabase project, so a preview
deployment is a real running app that can write production data — order
submissions, admin actions, the QBWC endpoint. Acceptable for solo work; if
external contributors or riskier branches appear, the fix is a separate
Supabase project (or branch DB) scoped to Preview only. Don't assume a preview
URL is a sandbox.
