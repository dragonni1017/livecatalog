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
1. **FIXED 2026-10-01 (PR after #80).** `cart-session` POST: no auth. Client-supplied names and prices are emailed by
   `lib/abandoned-cart.ts` from company SMTP to any address, which makes it a
   spam/phishing relay. It can also overwrite a real customer's saved cart. Now only `{sku, qty}` is taken from the caller.
   Names and prices come from `products` (active and visible only) on save, and are rebuilt again
   at send time. The greeting name is reduced to name characters (`lib/cart-session-items.ts`).
   Overwriting someone's saved cart, and a reminder to any typed address (with
   real product text only), are accepted residuals of guest checkout.
2. **FIXED 2026-10-01 (Dragon chose signed-in only).** `orders` POST: the tier/discount comes from the *typed* email, not the
   session. Anyone who knows a tiered customer's email gets their pricing on
   a quote. `placedByRep` is client-trusted for non-reps. Customer pricing now applies only
   when `getSessionUser().email` matches the order email (`isSignedInAsOrderEmail`).
   At the time only 2 customers had a tier, and both had accounts. `placedByRep` is left
   alone: the cart's "Placed by (rep)" dropdown is a deliberate guest-facing field.
3. **FIXED 2026-10-01 (migration 0053 + lib/order-access.ts; old links need sign-in, Dragon's call).** Order references are sequential (`ORD-<yr>[-TIER]-NNNN`).
   `app/(catalog)/order/[reference]` shows a customer's name, lines and prices
   for any reference. `order-reply` lets anyone message sales as that customer. Both now need the link's `?t=` token,
   a matching session, an admin, or the placing rep. The same pass found two more leaks:
   `/my-orders?email=` listed anyone's orders with no login (now session only), and
   `.ilike('customer_email', email)` treated `_`/`%` as wildcards, so `a_b@x.com` also saw
   `aXb@x.com`'s orders. That happened in account, my-orders and the qbwc customer link (now `ilikeExact`).
4. **FIXED 2026-10-01.** `auth/callback`: open redirect via `next=@evil.com`. Also `/login?from=//evil.com`
   (router.push), and `catalog-access`, whose `!startsWith('//')` check let `/evil.com` through. All three now
   use `safeInternalPath` (lib/safe-redirect.ts), which parses the target as a URL rather than string-matching it.
5. **FIXED 2026-10-02.** `qbwc` `getLastError` answers without a ticket, tickets never expire, and the
   password compare isn't constant-time. Now `getLastError` needs a live session, and tickets die on
   `closed_at` or 2h after `opened_at` (`lib/qbwc-session.ts`; real sessions max out at 2.8 min).
   Username and password are both compared with `safeEqual`.
6. **`track` FIXED 2026-10-02 (best-effort):** 60 events/min per IP via `lib/rate-limit.ts`, which is in-memory and per-instance,
   so not a global cap; a Vercel Firewall rule on `/api/track` would make it hard. productId is capped at 64 chars. Was: `track`: unlimited inserts. **FIXED 2026-10-02:** `/api/*` also skips the `CATALOG_ACCESS_CODE`
   gate, so `products/suggest` and `products/lookup` return prices while the
   catalog is gated. Worse, the gate cookie was the literal `granted`, settable by hand. Now it's an HMAC
   of the code, and gated APIs return 401 without it (`lib/catalog-gate.ts`), except sign-in, the code
   check, qbwc, cron and webhooks.

**Why:** a missed `/api` route reads as fine. It just works, for anyone.
**How to apply:** an admin-only route goes under `/admin/api/*`. A machine
route uses `lib/request-auth.ts`. Never use `if (!secret) return true`.
