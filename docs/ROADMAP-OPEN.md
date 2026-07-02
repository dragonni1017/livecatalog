# L&Y USA Catalog — Open / Not Yet Done

Split out from `docs/ROADMAP.md` on 2026-07-02.
Companion file: `docs/ROADMAP-COMPLETED.md` (everything already shipped).

**8 explicitly open checklist items**, plus 3 blocked-on-external-input items,
and 21 unscoped brainstorm ideas below. (Volume pricing, cross-sell, credit
applications, and packing slips — previously listed as "Recommended Next" —
shipped 2026-07-02; see `docs/ROADMAP-COMPLETED.md`.)

---

## Open Backlog

- [ ] SMS notifications via Twilio (order received / status change)
- [ ] Hook low-stock check into the Erply/Woo webhooks — the webhooks
      (`api/webhooks/erply`, `api/webhooks/woo`) exist and update `stock_qty`
      in real time, but only the daily cron currently triggers the low-stock
      alert; the webhooks don't call it yet

---

## Blocked / Pending Activation

| Item | What's blocking |
|---|---|
| **Erply auto-sync** | Waiting on Erply data being clean on their side |
| **Custom domain** (`lyusacatalog.com`) | Not yet purchased — just DNS config once bought |
| **Catalog access gate** | Built, dormant — flip `CATALOG_ACCESS_CODE` env var to activate |

---

## Design Backlog (open)

Priority order agreed 2026-07-02. Full direction/rationale in `docs/DESIGN-BRIEF.md`.

- [ ] **4. Logo & secondary accent color** — no real logo asset (it's a CSS-built 40×40px box with 9–10px text); only one brand color (`--brand-red`) exists, so status badges ("low stock," "new arrival") compete with CTAs for attention. Needs actual design input (asset + accent color choice) before code. Logo swap happens once in the shared `app/(catalog)/layout.tsx` + `Footer.tsx`.
- [ ] **5. Homepage hero / trust signals** — goes straight from header to best-sellers grid; no banner, no "why buy wholesale from us" trust signals (years in business, customer count, certifications). Blocked on trust-signal copy/numbers — sequence last.
- [ ] **5. Visual merchandising is thin** — no category banner images or lifestyle photography; the only imagery on the site is individual product shots. Blocked on sourcing photography — sequence last, same tier as hero/trust signals.

---

## Recommended Next

All four prior candidates (volume pricing, cross-sell, credit applications,
packing slips) shipped 2026-07-02. Next candidates TBD — pick from the
Future Brainstorm below.

---

## Future Brainstorm (unscoped)

**Catalog & browsing**
- Filter by brand / material / other product attributes (price range already shipped)
- Product comparison (side-by-side spec view)
- Downloadable spec sheets / line-card PDFs
- Curated/seasonal collections

**Ordering & quotes**
- Ship-to address book (multiple addresses per customer)
- Manager approval step (rep → manager → admin)
- Tax-exempt certificate upload

**Pricing & customers**
- Promo codes / time-limited sale pricing
- Per-customer price list PDF export
- Sales-tax calculation by ship-to state

**Inventory & fulfillment**
- Backorder handling
- Multi-warehouse stock visibility
- RMA / returns tracking
- Shipping-carrier rate quotes + label generation (UPS/FedEx)

**Integrations**
- EDI for large retail customers
- Outbound webhook for order events
- QuickBooks Online API (vs. current manual QB Desktop entry)

**Marketing & growth**
- Newsletter / new-arrivals email signup
- QR codes linking print catalogs to product pages
- Structured data (schema.org Product) for SEO rich snippets
- Browse → cart → submit funnel conversion report

---

## What Still Needs to Happen (your side)

- [ ] Purchase `lyusacatalog.com` and point it at Vercel (Settings → Domains)
- [ ] Confirm Erply data is clean so auto-sync can be enabled
- [ ] Formally test mobile layout on iOS Safari + Android Chrome

---

## Known gaps (not on any list above)

- **Barcode backfill** — 11 known stripped-zero rows still need backfilling in the DB; needs the external source-spreadsheet folder mounted to complete (see `docs/BARCODE-LEADING-ZERO-FIX-HANDOFF.md`).
