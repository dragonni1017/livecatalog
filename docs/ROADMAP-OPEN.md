# L&Y USA Catalog — Open / Not Yet Done

Split out from `docs/ROADMAP.md` on 2026-07-02.
Companion file: `docs/ROADMAP-COMPLETED.md` (everything already shipped).

**1 explicitly open checklist item**, plus 3 blocked-on-external-input items,
and 21 unscoped brainstorm ideas below. (Volume pricing, cross-sell, credit
applications, and packing slips — previously listed as "Recommended Next" —
shipped 2026-07-02; see `docs/ROADMAP-COMPLETED.md`. The low-stock/webhook
item formerly here shipped since — also moved there.)

---

## Open Backlog

- [ ] SMS notifications via Twilio (order received / status change)

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
- **QuickBooks customer matching is unexercised in production** (as of 2026-09-08) — the tiered match, the `needs_review` hold, and its "Use \<match\>" / "create new" buttons are verified against live *data* but no real order has flowed through them yet, and nothing has landed in the review band. Worth checking Admin → QuickBooks after the first order that isn't an exact match.
- **Duplicate customers in QuickBooks, left as-is by decision** (2026-09-08) — a scan of the 4,874-customer directory found ~15 near-certain duplicate pairs (`A Dodsons`/`ADODSONS`, `NVflorist`/`NV FLORIST`, `PALMETTO VILLE`/`PALMETTOVILLE`, …). Merging is a QuickBooks Desktop-only action (rename one to match exactly, accept the merge prompt); qbXML cannot do it. Nothing depends on this — duplicate names now hold for review instead of being guessed at — and the self-heal above cleans up the links afterward.
- **187 emails are shared across multiple QuickBooks customers** (as of 2026-09-08) — reps, buyers spanning venues, and shared AP inboxes (`michaellauber007@gmail.com` on 64 records, `invoice.noreply@greatwolf.com` on 25). Not a defect to fix, but it's why an email match must be unique to auto-link; anyone revisiting the matching tiers should keep that constraint.
