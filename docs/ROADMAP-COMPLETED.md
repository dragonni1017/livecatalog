# L&Y USA Catalog — Completed

Split out from `docs/ROADMAP.md` on 2026-07-02. Everything below is shipped/done.
Companion file: `docs/ROADMAP-OPEN.md` (everything not yet done).

**89 items completed** (82 shipped-feature bullets + 7 checked-off backlog/design items).

---

## Shipped Features

### Catalog (public-facing)
- ✅ Product grid with search (name + SKU), category filter, in-stock filter, pagination
- ✅ Product detail page — image, price, description, pack quantity, stock badge, barcode
- ✅ Category navigation — sidebar on desktop, tabs on mobile
- ✅ Related products ("More in this category") on product detail page
- ✅ Back-in-stock notification — email capture on out-of-stock products, auto-fires on restock
- ✅ SEO metadata + Open Graph per product page
- ✅ ISR caching (10-min revalidate) on product pages
- ✅ L&Y USA logo branding on header, product, and cart pages
- ✅ Sitemap + robots.txt

### Cart & Ordering
- ✅ Add to cart (product cards + detail page), persistent via localStorage
- ✅ Cart page — quantity controls, line totals, subtotal, order minimum enforcement
- ✅ Quick Order page — SKU-based bulk add
- ✅ Checkout form — name, email, phone, company, PO number, notes, CC email field
- ✅ Sales rep pre-fill via `?rep=` URL param (`RepCapture` component)
- ✅ Server-side order minimum enforcement (re-validated on submit)
- ✅ Order submitted → saved to Supabase as `order_request` with snapshotted line items

### Order Notifications (email)
- ✅ Rep notification email on every new order — full order detail sent to `sale@ly-usa.com`
- ✅ Customer confirmation email on submit — includes reference code + order status link
- ✅ CC sales rep email field on checkout (optional, forwards a copy to rep)

### Order Status (customer-facing)
- ✅ Order status page at `/order/ORD-YYYY-XXXX` — status badge, items, subtotal, date
- ✅ "Reorder all items" button — adds past order back to cart in one click
- ✅ Status stages: Received → In Progress → Confirmed → Closed

### Customer Accounts (public-facing)
- ✅ Email/password login + registration (Supabase Auth) — `/login`, `/register`
- ✅ Forgot-password / reset-password flow
- ✅ `/account` — profile details + order history (matched by email)
- ✅ `/account/settings` — edit profile

### Admin Dashboard
- ✅ Password-protected admin at `/admin` (single shared `ADMIN_PASSWORD` env var)
- ✅ Products & Stock page — full product list with search, category/visibility/active filters
- ✅ Inline stock adjustment per product (add/remove units with reason)
- ✅ Product visibility toggle (manually hide/show without deactivating)
- ✅ Inline product edit (name, description, image URL)
- ✅ Orders list — search by customer/reference, filter by status and QB-entered flag
- ✅ Order detail page — full customer info, items, rep, PO, QB toggle, print/Excel/customer-view links
- ✅ "Customer view ↗" button on admin order detail (previews what the customer sees)
- ✅ Printable sales order PDF per order (`/admin/orders/[id]/print`)
- ✅ Excel export per order (`/admin/api/orders/[id]/excel`)
- ✅ CSV bulk export of all orders (`/admin/api/orders/export`)
- ✅ QuickBooks "entered" toggle per order (manual QB Desktop workflow)
- ✅ Sales rep attribution + PO number fields on orders
- ✅ Printable wholesale price list (`/admin/price-list`) — filterable by category
- ✅ Import page — drag-and-drop Excel, diff preview, one-click confirm
- ✅ Import history log (`/admin/imports`)
- ✅ Sync page — manual Erply sync trigger + status (`/admin/sync`)
- ✅ Analytics dashboard (`/admin/analytics`):
  - Orders over time chart (30-day bar chart)
  - Total orders, quote value, conversion rate
  - Most viewed products (from `analytics_events` table)
  - Top search terms

### Inventory Alerts
- ✅ Low-stock email alert — fires when products drop to/below threshold (default: 5 units)
- ✅ De-dupe: each product only alerts once per restock cycle
- ✅ Alert recipient: `sale@ly-usa.com` via Titan SMTP
- ✅ Triggers on: Excel import + daily cron (even when Erply is unconfigured)
- ✅ Back-in-stock alert — auto-emails subscribers when a restocked product comes back in stock

### Tracking & Analytics
- ✅ Product view tracking (`/api/track` — fires on every product detail page load)
- ✅ Search term tracking (fires on debounced search input)
- ✅ Orders tracked in `order_requests` + `order_items` tables

### Infrastructure
- ✅ Vercel deployment with auto-deploy on push
- ✅ Daily cron job at 8am (Erply sync + low-stock check)
- ✅ Supabase RLS — all public tables locked; admin reads/writes via service-role key
- ✅ Cloudinary image CDN with responsive transforms
- ✅ Catalog access code gate built (env-var activated, currently dormant)

### Recently Shipped (as of 2026-06-29)
- ✅ Buyer profiles & pricing — `customers` table + `/admin/customers`; order detail page shows buyer discount + discounted subtotal
- ✅ Favorites / saved list — heart button on cards + `/favorites` page
- ✅ Search autosuggest/typeahead — dropdown with image, name, SKU, category
- ✅ Best-sellers section on homepage (from `analytics_events`)
- ✅ Date range filter on analytics (7D / 30D / 90D / All time)
- ✅ Bulk stock adjustment — checkboxes + sticky bar on admin products page
- ✅ "Searched, zero results" report — `/admin/zero-results`
- ✅ Price-per-case display alongside price-per-unit
- ✅ Remember contact info across visits (name/email/company/PO)
- ✅ Admin 2FA (TOTP) — `/admin/2fa-setup`
- ✅ Audit log — stock + order/QB changes → `/admin/audit-log`
- ✅ Abandoned-cart reminder email
- ✅ Per-product reorder thresholds
- ✅ New Arrivals category
- ✅ Multiple images per product + gallery
- ✅ Barcode scan-to-search
- ✅ CSV bulk order upload (Quick Order page)
- ✅ Save cart as draft
- ✅ Rush / required-ship-date flag
- ✅ Price range filter

### Recently Shipped (as of 2026-07-02)
- ✅ Quantity-break / volume discount pricing — `volume_tiers` on products, applied on product detail page, cart, order rules, and admin product edit / bulk stock tools
- ✅ "Customers also ordered" cross-sell — co-purchase query against `order_items` on the product detail page
- ✅ Net-terms / credit application — customer-facing form (`/credit-application`), `credit_applications` table, API route, admin review dashboard (`/admin/credit-applications`)
- ✅ Packing slip generation — `/admin/orders/[id]/packing-slip`
- ✅ Erply/Woo webhook endpoints for real-time stock sync — `/api/webhooks/erply`, `/api/webhooks/woo` (update `stock_qty` immediately on incoming events; daily cron still the only trigger for the low-stock check — see `docs/ROADMAP-OPEN.md`)

---

## Backlog items completed

- ✅ **Admin auth hardening** — replaced `ADMIN_PASSWORD` cookie gate with Supabase role-based auth; per-staff email/password login, `app_metadata.role` gate in middleware
- ✅ **API route refactoring** — extracted email logic to `lib/order-emails.ts`, validation to `lib/order-validation.ts`, atomic order submission via `submit_order` RPC; split large components (ExcelDropzone, BulkStockTable, QuickOrder)
- ✅ **Test suite** — Vitest configured; 33 tests across `order-rules`, `order-validation`, and `pack` modules all passing (verified 2026-07-02)

---

## Design Backlog items completed

Verified against code 2026-07-02 — see `docs/DESIGN-BRIEF.md` for original rationale.

- ✅ **Duplicate homepage / missing footer (structural bug)** — `app/page.tsx` and `app/(catalog)/page.tsx` both resolved to `/`; only the former had the footer, phone number, and "Product Catalog 2026" tagline, so every other page on the site (product, cart, account, login, category, etc.) was missing them. Fixed: merged the richer homepage logic into `app/(catalog)/page.tsx`, deleted the stray `app/page.tsx`, extracted `components/catalog/Footer.tsx`, and now render it (plus the tagline/contact info) from the shared `app/(catalog)/layout.tsx` so it's consistent site-wide.
- ✅ **1. Typography** — wired Inter via `next/font/google` in `app/layout.tsx`; `--font-sans` now points to `--font-inter`; removed hardcoded Arial override from `globals.css`.
- ✅ **2. Loading states are blank, not skeletons** — replaced `fallback={null}` on `CategoryNav` (pill strip on mobile, sidebar list on desktop) and `CatalogControls` (checkbox + two selects) with `animate-pulse` skeletons matching each component's footprint; applied to both `(catalog)/page.tsx` and `new-arrivals/page.tsx`.
- ✅ **3. Quote-vs-checkout clarity** — promoted the quote disclaimer from a small gray caption to a blue info banner with icon on both the product detail page and cart checkout panel; clearly visible without competing with the red CTA.
