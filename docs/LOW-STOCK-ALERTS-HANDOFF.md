# Handoff: Low-Stock Reorder Email Alerts

**Status:** Planned, not implemented. Picked up from a planning conversation — this doc has everything needed to build it without re-deriving context.

**For Claude Code:** read this fully before touching code. Update the "Progress Log" section at the bottom as you work — check off steps, note any deviations from the plan, and record any new decisions made with the user so the next session (human or agent) isn't starting cold.

---

## Goal

Send an email to a specific person when a product's stock drops to or below a reorder threshold, so they know to reorder. No alert spam — each low-stock event should fire once, not on every sync.

## Existing architecture (context)

This is a Next.js + Supabase product catalog. Stock levels (`stock_qty` on the `products` table) get written from three places:

1. **`lib/product-sync.ts` → `syncToSupabase()`** — the shared upsert function used by both:
   - `app/api/import/route.ts` (manual admin Excel upload)
   - `app/api/sync/route.ts` (Erply cron sync)
   This is the single chokepoint both batch paths funnel through.
2. **`app/api/webhooks/erply/route.ts`** — real-time in-store stock changes from Erply (POS sales, adjustments). Writes `stock_qty` directly, bypasses `syncToSupabase()`.
3. **`app/api/webhooks/woo/route.ts`** — real-time WooCommerce order events. Also writes directly, bypasses `syncToSupabase()`.

`lib/supabase.ts` exports `getAdminClient()` for server-side writes (service role key) — use this for the alert logic, same as the existing sync code does.

No email-sending infrastructure exists anywhere in this repo today. No `reorder_point`/threshold column exists on `products`. No SQL migration files live in this repo — schema changes get applied directly via the Supabase SQL editor (see `.env.example` for the project's env var conventions).

## Decisions already made with the user

- **Email transport: Titan Mail SMTP**, not a transactional API (Resend/SendGrid). The user's email is hosted via Titan on their WordPress domain. Use `nodemailer` against Titan's SMTP server.
- **Threshold model: one global threshold**, not per-product. A single env var, no schema column for the threshold itself.
- **Trigger timing: piggyback on the existing sync/cron path only** (i.e., hook into `syncToSupabase()`). The user explicitly chose this over real-time webhook checks or a separate daily digest. Known accepted gap: the Erply/Woo webhooks bypass this and won't trigger alerts until the next scheduled sync — mirrors the existing tradeoff already accepted for the Erply webhook itself (its own code comment says the cron already catches everything and the webhook is just for cases where 30-min lag isn't acceptable).

## Open inputs still needed from the user (ask before/while implementing)

- [ ] Titan SMTP credentials: mailbox address + password (or app-specific password if 2FA is enabled on the mailbox). Titan's SMTP host is typically `smtp.titan.email`, port `465` (SSL) — confirm in their Titan control panel under mail client setup.
- [ ] The recipient address — the "specific person" who should receive alerts. Not yet specified. (Could default to the user's own address, `dragon.ni1017@gmail.com`, or a different person — confirm.)
- [ ] The actual threshold number (e.g. `5` units). Not yet specified.
- [ ] A "from" address/display name for the alert emails (likely the same Titan mailbox).

## Implementation plan

### 1. Dependencies
```
npm install nodemailer
npm install -D @types/nodemailer
```

### 2. Env vars — add to `.env.example` and `.env.local`
```
# ── Low-stock reorder alerts ───────────────────────────────────────────────
TITAN_SMTP_HOST=smtp.titan.email
TITAN_SMTP_PORT=465
TITAN_SMTP_USER=
TITAN_SMTP_PASS=
REORDER_ALERT_FROM=
REORDER_ALERT_TO=
REORDER_THRESHOLD=5
```

### 3. Schema change (run in Supabase SQL editor)
Add a de-dupe flag so the same low-stock event doesn't re-alert on every sync:
```sql
alter table products
  add column low_stock_alerted boolean not null default false;
```

### 4. `lib/email.ts` — new file
Small nodemailer wrapper:
- Create a transporter from the `TITAN_SMTP_*` env vars (host, port, `secure: true` for port 465, auth user/pass).
- Export a `sendMail({ to, subject, text })` function (or similarly minimal signature). Keep it generic — don't bake low-stock-specific content into this file.

### 5. `lib/low-stock-alert.ts` — new file
Export `checkLowStockAndNotify(db: DB)`:
1. **Reset pass:** `update products set low_stock_alerted = false where stock_qty > <threshold> and low_stock_alerted = true`. (Lets a product re-alert next time it dips low again after being restocked.)
2. **Find pass:** `select sku, name, stock_qty from products where is_active = true and stock_qty <= <threshold> and low_stock_alerted = false`.
3. If the result set is empty, return early — no email.
4. Otherwise build **one** email (not one per product) listing SKU / name / current qty / threshold, send via `lib/email.ts` to `REORDER_ALERT_TO`.
5. Mark those rows `low_stock_alerted = true`.

Read `REORDER_THRESHOLD` from env (parse as int, fall back to a sane default like `5`).

### 6. Wire it in
In `lib/product-sync.ts`, at the end of `syncToSupabase()` (after the deactivate step, before `return`), call `await checkLowStockAndNotify(db)`. Wrap in try/catch and log on failure — a notification failure should never fail the sync itself.

### 7. Testing checklist
- [ ] Manually set a test product's `stock_qty` below `REORDER_THRESHOLD` via Supabase, then trigger an import/sync — confirm exactly one email arrives listing that product.
- [ ] Re-run the sync without changing stock — confirm **no** second email (de-dupe works).
- [ ] Restock the product above threshold, sync again, confirm `low_stock_alerted` resets to `false`.
- [ ] Drop it low again, sync, confirm a **new** alert fires.
- [ ] Confirm a sync with nothing low sends no email and doesn't error.
- [ ] Confirm SMTP auth failures are caught/logged, not thrown (don't want a bad mailbox password to break product syncing).

## Out of scope for this pass

- Per-product reorder thresholds (deferred — global only for v1).
- Hooking the Erply/Woo webhooks into the same check (deferred — known gap, see above).
- Admin UI for configuring threshold/recipient (env vars only for v1).

---

## Progress Log

*(Claude Code: append entries here as you work — what you did, any decisions made with the user that weren't already captured above, anything left unfinished.)*

- **2026-06-19 — Built & deployed (code complete; dormant pending env + SQL).**
  - Installed `nodemailer` + `@types/nodemailer`.
  - Added `lib/email.ts` (Titan SMTP wrapper, per-call transporter, timeouts, `isEmailConfigured()` guard) and `lib/low-stock-alert.ts` (`checkLowStockAndNotify` with reset → find → one-email → mark dedupe; `getThreshold()` reads `REORDER_THRESHOLD`, default 5).
  - Wired into `syncToSupabase()` step 7 (covers manual Excel import + real Erply sync), try/catch so a mail failure never fails the sync.
  - **Deviation from plan (approved by user):** also call `checkLowStockAndNotify` in the `app/api/sync` stub-skip branch. Reason: after the 2026-06-19 stub-mode catalog-wipe incident, `/api/sync` now skips the destructive product sync when Erply is unconfigured — so piggybacking only on `syncToSupabase()` would mean the daily cron never alerts. The skip branch now runs the (non-destructive) stock check daily regardless of Erply. User chose "Daily cron + on import."
  - `.env.example` documents the 7 new vars. Deployed to prod; `/api/sync` verified returning `lowStock: {skipped: "email not configured"}` (safe no-op).
  - **Still needed to activate:** (1) run `alter table products add column low_stock_alerted boolean not null default false;` in the Supabase SQL editor; (2) set `TITAN_SMTP_*`, `REORDER_ALERT_FROM/TO`, `REORDER_THRESHOLD` in `.env.local` AND Vercel prod env; (3) set `CRON_SECRET` in Vercel so the now-emailing cron isn't publicly triggerable.
  - **Known reality:** all products currently have placeholder `stock_qty = 999`, so no alert will fire until real stock data flows in (manual import "Stock Qty" column, or Erply). Test by manually setting one product's `stock_qty` below the threshold and hitting `/api/sync`.
  - **Not done (out of scope, unchanged):** Erply/Woo webhooks don't trigger the check; per-product thresholds; admin UI for threshold/recipient.

- **2026-06-26 — Activation attempt: found `/api/sync` hangs in prod, paused pending dashboard check.**
  - Confirmed `vercel.json` cron (`0 8 * * *`) has been deployed since 2026-06-18 across many subsequent production deploys — config itself looks correct.
  - Hit `https://livecatalog.vercel.app/api/sync` directly (the same stub-safe path this doc's testing checklist uses) via two different fetch tools — both **timed out** with no response at all (not even a 401).
  - Checked Vercel runtime logs (24h and 48h) and runtime errors (24h) for the production env — **zero `/api/sync` entries**, not even from the manual hit above. Either the request never reaches the function, or logging has a delay longer than checked.
  - No available tool can read Vercel's Cron Jobs run-history or env var values directly — asked the user to check the Vercel dashboard (Project → Cron Jobs tab for run history; Settings → Environment Variables for `TITAN_SMTP_*`, `REORDER_ALERT_FROM/TO`, `REORDER_THRESHOLD`, `CRON_SECRET`). User agreed to check.
  - **Still blocked on:** (1) confirming the cron has ever actually fired in prod; (2) confirming the 7 env vars above are set in Vercel prod (not just `.env.local`); (3) diagnosing the hang itself (likely candidates: a real Erply API call now hanging if credentials were added since 2026-06-19's stub-mode check, or an SMTP connection attempt without an effective timeout) — needs Vercel dashboard/log access this session's tools don't have, or a code-level look once the dashboard findings are in.
