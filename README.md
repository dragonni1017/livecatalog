# L & Y USA — Live Wholesale Catalog

A public-facing wholesale product catalog with live inventory, search, and a
quote-request ordering flow. Customers and sales reps browse the catalog and
submit order requests; the team reviews them in an admin dashboard and keys
them into QuickBooks Desktop.

**Stack:** Next.js (App Router) · Supabase (Postgres) · Vercel · Cloudinary (images)
**Production:** https://livecatalog.vercel.app

---

## How it works

```
Customer / rep browses the catalog
   → adds in-stock items, submits an order request
   → request is saved to Supabase + emailed to sale@ly-usa.com (customer gets a confirmation)
   → team reviews in /admin/orders (filter, status, "entered in QuickBooks")
   → prints the Sales Order (PDF) and keys it into QuickBooks Desktop
```

Product data is loaded via the admin Excel import (drag-and-drop). An Erply
auto-sync exists but is not yet enabled. There is no online payment — checkout
submits a quote request, not a charge.

### Tech stack

| Layer | Tool | Cost |
|---|---|---|
| Frontend | Next.js 16 (App Router) | Free |
| Hosting | Vercel | Free tier |
| Database | Supabase (PostgreSQL) | Free tier |
| Email | Titan Mail SMTP via nodemailer | Included with domain |
| Image CDN | Cloudinary | Free tier |
| Excel parsing | SheetJS (browser-side) | Free / open source |
| Future: Erply sync | Erply REST API | Already paying |

### Excel import format

| Column | Required | Notes |
|---|---|---|
| `SKU` | Yes | Unique key — re-uploading same SKU updates, never duplicates |
| `Name` | Yes | Product display name |
| `Category` | Yes | Must be consistent — "Footwear" ≠ "footwear" |
| `Price` | Yes | Numeric, no $ sign |
| `Description` | No | Short product description |
| `Stock Qty` | No | Defaults to 0 if blank |
| `Image URL` | No | Direct link to hosted product image |
| `Active` | No | TRUE/FALSE — hide without deleting |

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint
```

Copy `.env.example` to `.env.local` and fill in the values (Supabase keys,
admin password, Titan SMTP for email, etc.).

## Project structure

```
app/                     Next.js routes (App Router)
  page.tsx               Public catalog homepage (the live one)
  (catalog)/             Cart, product detail, quick-order, category, gate
  admin/                 Password-protected admin (orders, products, import, sync…)
  api/                   Public API routes (orders, track, products/lookup…)
components/
  catalog/               Customer-facing UI (ProductCard, cart, search…)
  admin/                 Admin UI (orders table, status controls, dropzone…)
lib/                     Supabase client, email, image/CDN, order rules, types…
supabase/migrations/     SQL migrations (applied by hand in the Supabase SQL editor)
scripts/                 One-off maintenance scripts (import, sync, backfill)
public/                  Static assets + Excel import template
docs/                    Project docs — roadmap, feature plans, handoffs
```

## Conventions

- **Migrations are applied manually** in the Supabase SQL editor (no migration
  runner). Each file in `supabase/migrations/` has a header explaining it.
- **Admin auth** is a single shared password (`ADMIN_PASSWORD`); the public
  catalog can optionally be gated with `CATALOG_ACCESS_CODE`.
- **Deploy** with `vercel --prod` (see `docs/` for details).

## Docs

See [`docs/`](./docs) — `ROADMAP-OPEN.md` / `ROADMAP-COMPLETED.md` (roadmap,
split by status), the cart/order plan, and feature handoffs.
