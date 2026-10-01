---
name: project-api-route-auth-audit-20261001
description: 2026-10-01 audit of every app/api route (middleware lets /api/* through ungated). Import was open (fixed #79), 6 routes failed open on a missing secret (fixed, ERPLY_WEBHOOK_TOKEN was unset in prod), 6 lower findings still OPEN
type: project
---

`middleware.ts` gates `/admin/*` and `/rep/*` only. **Every `/api/*` route is
public**, so the route's own check is the only guard. Read-only audit of all 24
`app/api/**/route.ts` on 2026-10-01:

**Fixed the same day**
- `/api/import[/diff]`: no auth at all, writing products with the service-role
  client. Moved to `/admin/api/import` (#79).
- Six routes `return true` when their secret env var is unset:
  `webhooks/erply` (+`/customers`), `webhooks/woo` (+`/customers`), `sync`,
  `sync/customers`. All now go through `lib/request-auth.ts` and fail closed.
  `ERPLY_WEBHOOK_TOKEN` has **never been set in Vercel**, so `webhooks/erply` was
  writable by anyone: arbitrary `stock_qty` for any SKU. `CRON_SECRET` and
  `WOO_WEBHOOK_SECRET` are set in production (names-only listing), so the others
  weren't exploitable there. The Erply/Woo webhooks aren't registered with either
  vendor, so failing closed broke nothing.

**Still OPEN (not fixed)**, most severe first:
1. `cart-session` POST: no auth. Client-supplied names and prices are emailed by
   `lib/abandoned-cart.ts` from company SMTP to any address, which makes it a
   spam/phishing relay. It can also overwrite a real customer's saved cart.
2. `orders` POST: the tier/discount comes from the *typed* email, not the
   session. Anyone who knows a tiered customer's email gets their pricing on
   a quote. `placedByRep` is client-trusted for non-reps.
3. Order references are sequential (`ORD-<yr>[-TIER]-NNNN`).
   `app/(catalog)/order/[reference]` shows a customer's name, lines and prices
   for any reference. `order-reply` lets anyone message sales as that customer.
4. `auth/callback`: open redirect via `next=@evil.com`.
5. `qbwc` `getLastError` answers without a ticket, tickets never expire, and the
   password compare isn't constant-time.
6. `track`: unlimited inserts. `/api/*` also skips the `CATALOG_ACCESS_CODE`
   gate, so `products/suggest` and `products/lookup` return prices while the
   catalog is gated.

**Why:** a missed `/api` route reads as fine. It just works, for anyone.
**How to apply:** an admin-only route goes under `/admin/api/*`. A machine
route uses `lib/request-auth.ts`. Never use `if (!secret) return true`.
