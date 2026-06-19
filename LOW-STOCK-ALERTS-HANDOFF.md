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

- _(empty — not started)_
