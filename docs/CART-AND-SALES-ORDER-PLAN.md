# Shopping Cart + Sales Rep Notification — Feature Plan

**Status:** Planning only — no code written yet.
**Builds on:** the existing read-only catalog (Next.js App Router + Supabase + Vercel). See `ROADMAP.md` Phase 4b, which deferred cart/checkout — this plan replaces that deferred item with a scoped-down, non-payment version.

## Decisions locked in

- **No payment processing.** The cart produces an *order request* (effectively a quote request), not a paid transaction. A human rep handles pricing confirmation, invoicing, and payment outside this app.
- **"Convert to sale order" is a status flag only, for now.** Marking an order "Converted" just records that decision in our own database. Whether that later pushes into Erply or QuickBooks Desktop is an explicit Phase 4 item, not part of this build — see "Future hook" below so today's work doesn't block it.
- **Email reuses the existing infra.** `lib/email.ts` (Titan SMTP via nodemailer) already powers the low-stock alert. The order-notification email uses the same `sendMail()` helper and the same "stays dormant if env vars aren't set" guard — no new email service to set up or pay for.
- **Guest checkout now, accounts later.** No login for v1. The data model stores contact info directly on the order so a later "customer accounts" feature can link existing orders to an account without a schema rework.

---

## Feature 1 — Shopping Cart & Order Requests

### Customer-facing flow

1. **Add to Cart** button on `ProductCard` and the product detail page (`app/(catalog)/product/[id]/page.tsx`). Disabled / relabeled when `stock_qty === 0`.
2. **Cart indicator** in the header — `app/(catalog)/layout.tsx` already has an empty placeholder div ("Right side: empty for now") that's the natural slot for a cart icon + item count.
3. **`/cart` page** — line items with quantity steppers, remove, running subtotal/total, "Submit Order Request" button.
4. **Checkout form** (same page or `/cart/review`) — name, email, phone, company (optional), notes field. No payment fields.
5. **Submit** → `POST /api/orders` → confirmation page: "Request received — a sales rep will follow up shortly," plus the order's reference number.

### Cart state

Client-side only (no DB writes until submit). A React Context + `localStorage` (this is the production site, not a Claude artifact, so `localStorage` is fine here) holding `{ productId, sku, name, priceCents, qty }[]`. Survives page reloads/tab close; cleared on successful submit.

### Data model (new Supabase tables)

```
order_requests
  id                 uuid pk
  reference_code     text unique          -- short human-readable id, e.g. ORD-2026-0042
  status              text                -- 'new' | 'contacted' | 'converted' | 'lost'
  customer_name       text
  customer_email      text
  customer_phone      text null
  customer_company    text null
  notes               text null
  subtotal_cents      integer             -- sum of line items at submit time
  assigned_rep_email  text null           -- which rep is handling it (Phase 2 routing)
  status_changed_by   text null           -- which admin last changed status
  status_changed_at   timestamptz null
  created_at          timestamptz
  updated_at          timestamptz

order_items
  id              uuid pk
  order_id        uuid fk -> order_requests.id
  product_id      uuid fk -> products.id null   -- nullable: keep the row even if the product is later deleted
  sku             text                          -- snapshot, survives product deletion/renaming
  name            text                          -- snapshot
  unit_price_cents integer                       -- snapshot of price_cents AT SUBMIT TIME
  qty             integer
  line_total_cents integer
```

Snapshotting `sku`/`name`/`unit_price_cents` on the line item (rather than only joining live to `products`) matters because catalog prices change — an order from three weeks ago should show what the customer was quoted, not today's price.

### `POST /api/orders`

- Receives cart items (product id + qty) + contact form.
- Re-fetches current `price_cents`/`stock_qty` from Supabase server-side per item (never trust client-submitted prices) — this is also the right place to reject/flag items that went out of stock between add-to-cart and submit.
- Computes `subtotal_cents`, generates `reference_code`, inserts `order_requests` + `order_items` via `getAdminClient()` (same admin-client pattern used by `/api/import`).
- Fires the notification email (Feature 2), but **does not let an email failure fail the order** — the order request is the source of truth; email is best-effort. Mirrors how `low-stock-alert.ts` already treats email as optional/dormant-safe.
- Returns `{ referenceCode, orderId }`.

---

## Feature 2 — Sales Rep Notification Email

### Sending

Reuse `lib/email.ts` exactly as-is (`isEmailConfigured()` / `sendMail()`). No new SMTP provider, no new package. This keeps the project on one email system instead of two.

New env vars (same file/section as the existing `REORDER_ALERT_*` vars):

```
SALES_ALERT_TO=        # comma-separated rep emails — shared inbox or a small list
SALES_ALERT_FROM=      # optional, defaults to TITAN_SMTP_USER like the reorder alert does
```

Starting with a **shared distribution address or comma-separated list** (not a routing table) matches what you actually asked for — "sales reps can reach out" reads as several people watching one inbox, not a strict 1:1 assignment system. If you later want round-robin/territory assignment, that's an additive change: add a `sales_reps` table and an `assigned_rep_email` lookup before sending, the email-sending code itself doesn't change.

### Email content

- **Reply-To: the customer's email.** A rep hitting "Reply" in their inbox should land in a message to the customer, not back to the system — this is the cheapest possible version of "reach out."
- Subject: `New order request ORD-2026-0042 — Acme Corp ($482.50)`
- Body: customer contact block, line items (SKU, name, qty, unit price, line total), subtotal, notes field, and a direct link to the order's admin detail page (`/admin/orders/[id]`) so a rep can jump straight to marking status.

### Reliability

Order creation must not roll back or 500 if the email send throws — wrap in try/catch, log, and optionally set a `notify_failed` flag for a "resend notification" button in the admin view (small extension, not required for v1).

---

## Admin: Rep Workflow

New `/admin/orders` page (password-protected via the existing `middleware.ts`, same as `/admin/products`):

- Table of `order_requests`, newest first: reference code, customer/company, total, status badge, submitted date. Same table styling as `app/admin/products/page.tsx`.
- Row click → `/admin/orders/[id]` detail: full contact info, line items, notes, and status controls.
- Status buttons: **Contacted**, **Converted**, **Lost** — same toggle-button pattern as `ProductVisibilityToggle.tsx`. Each write updates `status`, `status_changed_by`, `status_changed_at`.
- **"Converted" is the future integration hook.** For v1 it's just a status + timestamp. Leave one clearly-named, currently-empty function (e.g. `lib/order-conversion.ts: convertOrderExternally(order)`, a no-op today) so that wiring it to Erply's `saveSalesDocument` (Erply already has working API plumbing in `lib/erply.ts`) or to QuickBooks Desktop later is a contained change, not a rebuild of this feature.

---

## Open questions to settle before/while building

These mirror the "Key questions to resolve" style from `ROADMAP.md`:

- **Who's on `SALES_ALERT_TO` today**, and is one shared address actually right, or do you already know it should be 2–3 named reps from day one?
- **Reference code format** — `ORD-2026-0042` sequential, or something tied to the customer/company?
- **Out-of-stock at submit time** — block the line item, let it through with a flag for the rep, or block the whole submission?
- **Order history visibility for the customer** — none planned for guest checkout v1; confirm that's fine for now (a future login feature would need a `customers` table and a way to link past guest orders by matching email).
- **Erply vs. QuickBooks Desktop** for the eventual "Converted" integration — explicitly deferred, but worth knowing which one comes first so `convertOrderExternally()` isn't built twice.

---

## Suggested build order

1. **Schema** — `order_requests` + `order_items` migration, RLS (public can INSERT only, no SELECT; admin/service-role does everything else — same pattern as `products`).
2. **Cart UI** — Context/localStorage cart, Add to Cart buttons, `/cart` page, checkout form.
3. **`/api/orders`** — validation, snapshot pricing, insert, reference code generation.
4. **Email notification** — env vars, template, wired into the order API, failure-safe.
5. **Admin orders list + detail + status controls.**
6. **(Deferred)** Rep routing/assignment, customer accounts/login, Erply/QuickBooks conversion hook.

## New env vars

```
SALES_ALERT_TO=
SALES_ALERT_FROM=
```

(No new services, no new packages — `nodemailer` and `@supabase/supabase-js` already cover this.)
