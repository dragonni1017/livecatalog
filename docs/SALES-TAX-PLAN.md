# Sales tax by ship-to state: plan

Status (2026-10-19): **phases 1 and 2 built** (migration 0066 applied,
`lib/sales-tax.ts`, `/admin/sales-tax`, the estimate shown and saved on
orders). Phase 3 not started. The rate table is still empty, so buyers see
no tax until someone fills it in.

## Where things stand today

- Orders are **quote requests**. Nobody pays online, and the invoice is made
  in QuickBooks Desktop after an admin converts the order.
- No tax anywhere in the app. The cart, order page and emails show a
  subtotal only.
- Ship-to state is stored as a two-letter code (`order_requests.ship_state`,
  normalized since #136).
- Resale certificates (#135, migration 0057) record a `state`, `status`
  (pending / verified / rejected), `expires_on` and `replaced_at`, matched to
  orders by lowercased email. Review is a record only. Nothing marks a
  customer tax-exempt in QuickBooks.
- **QuickBooks already computes tax on what we send.** The Web Connector
  sync (`app/api/qbwc/route.ts`, `buildSalesOrderAddRq`) sends sales orders
  with no tax fields. QuickBooks then applies the QB customer's own tax code
  and tax item.
- Volume: 34 orders so far, by ship-to state: none 15, CA 9, MT 3, FL 2,
  TX 2, NY 1, IL 1, NV 1. **0 resale certificates on file.**

## The main decision: estimate in the app, QuickBooks charges

The app shows an **estimated** sales tax on the cart, the order and the
emails. QuickBooks stays the only place tax is actually charged. The app
sends QuickBooks no tax amount.

Why:
- Sending our own tax line to a QuickBooks that already adds tax would
  charge it twice.
- Real rates depend on the city and district, not just the state (CA runs
  7.25% to 10.75%). A one-rate-per-state table can only be an estimate. Exact
  tax would need a paid tax service (Avalara, TaxJar), which is out of scope
  for v1.
- Nobody pays at checkout, so an estimate that's off by a few cents or a
  district rate costs nothing. The invoice is still correct.

Everything is labelled "Estimated sales tax. Final tax is on your invoice."

**Off until configured.** With no state set up, nothing a buyer sees
changes. Turning on a state is a data change in the admin page, not a deploy.

## Rules

For an order with subtotal S (after tier, customer and promo pricing, which
are already in the line totals):

1. Normalize the ship-to state. If no active rate is set for it, tax is $0
   and nothing is shown ("not collected").
2. **Exempt** if the buyer is signed in as the order email and has a resale
   certificate that is `verified`, not expired, not replaced, and **for the
   ship-to state**. Shown as "Tax exempt (resale certificate on file)".
3. Otherwise tax = round-half-up(S × rate) to the cent, on the whole order.
4. The minimum-order check stays on the pre-tax subtotal.
5. A **pending** certificate doesn't exempt. The estimate shows tax with a
   note: "Your resale certificate is pending review. Tax will be removed once
   it's verified."

Guests have no session and so no certificate. They get the plain estimate.
A rep pricing an order for a customer gets that customer's exemption (the
rep is signed in and trusted); a customer typing someone else's email
doesn't.

## Build

### Phase 1: rates and rules (nothing changes for buyers)

- **Migration 0066**
  - `sales_tax_states`: `state` (2-letter, primary key), `rate_percent`
    (0 to 20), `is_active`, `note`, `updated_at`, `updated_by`. Server-read
    only: RLS on, no policies, grants looped over `pg_roles`.
  - `order_requests` gets four columns, a snapshot like the prices:
    `tax_state`, `tax_rate_percent`, `tax_estimate_cents`, and
    `tax_exempt_reason` (`resale_certificate` | `not_collected` | null).
    Existing orders stay null, which reads as "no estimate".
- **`lib/sales-tax.ts`**: pure `estimateSalesTax({ shipState, subtotalCents,
  rates, certificates, today })`. It's the only place the rule lives, the
  same way `lib/customer-pricing.ts` is for prices. The loader that reads the
  active rates and the buyer's certificates moved to phase 2, which is the
  first code that needs it.
- **`/admin/sales-tax`**: a table of 50 states + DC. Set a rate, toggle
  active, add a note (e.g. "base rate, no district"). The API goes under
  `/admin/api/sales-tax` so `middleware.ts` guards it.
- `tests/sales-tax.test.ts`: no rate, exempt / pending / expired / other-
  state certificate, rounding, guest.

### Phase 2: show it

- `/api/cart/tax-estimate` (a separate endpoint, not `/api/cart/reprice`)
  returns the estimate for the ship-to state entered, and the cart shows it
  under the subtotal once a state is chosen.
- `/api/orders` calculates it again on the server (the cart value is never
  trusted, same as promo codes) and saves the four columns.
- Shown with the subtotal on: the order page `/order/[reference]`, the
  customer and rep emails, `/admin/orders/[id]` (plus print, Excel and CSV
  export). The list pages (`/my-orders`, `/rep/quotes`, the admin order list)
  still show the subtotal only.
- The QuickBooks sales order memo gets one more line for whoever reviews it:
  `Est. tax CA 7.25%: $12.34 (app estimate)` or `Tax exempt: resale cert CA`.
  It's still **not** sent as a tax line.
- Tests: the order route test covers not collected / taxed / guest-with-
  someone's-email / signed-in exempt. The live e2e covers the cart endpoint
  with a temporary PR rate it removes afterwards.

### Phase 3: QuickBooks exemption (separate decision, not in this plan's scope)

When a certificate is verified, set the QuickBooks customer to non-taxable
through the Web Connector (`CustomerMod`). That writes to the real customer
list, and the resale certificates note says to ask before wiring status into
QuickBooks. Until then, exemptions in QuickBooks stay hand-keyed as today.

## Questions for whoever owns tax (not decisions the app should make)

1. **Which states do we collect in, and at what rate?** For CA: the 7.25%
   base or the rate where we ship from? This fills the admin table. It starts
   empty.
2. **Is an estimate acceptable** on quotes, or must the quote total match the
   invoice exactly? Exact needs a tax service (paid, ZIP-level).
3. **Which certificates count?** Only one for the ship-to state, or also
   multistate forms (MTC / Streamlined)? The plan assumes ship-to state only.
4. **Any non-taxable products** (e.g. candy or food in some states)? The plan
   treats everything as taxable.
5. **Is sales tax switched on in the QuickBooks company file,** and are
   customer tax codes kept up to date? If not, the invoice won't match the
   estimate at all.

## Out of scope

- Charging or collecting tax online (there's no online payment).
- Tax on shipping (the app doesn't price freight).
- Filing or reporting returns. That stays in QuickBooks.
