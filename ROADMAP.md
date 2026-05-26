# Live Inventory Catalog — Project Roadmap

**Project:** Public-facing product catalog website with live inventory, search, and category filtering  
**Stack:** Next.js · Supabase · Vercel  
**Current data source:** Excel file upload (drag-and-drop admin page)  
**Future data source:** Erply API (when migration is complete)  
**E-commerce:** Deferred — Stripe or Shopify to be decided later

---

## Overview

The goal is a fast, searchable catalog website that reflects your current inventory. Products, categories, prices, and stock levels are managed in Excel for now. When you want to update the catalog, you export your Excel and drag it onto the admin page — the site updates immediately. No command line, no manual copy-paste.

When Erply is ready, the auto-sync replaces the manual upload step. Everything else stays the same.

---

## How Updating Works (MVP)

```
You update your Excel file
        ↓
Go to yoursite.com/admin (password protected)
        ↓
Drag and drop the Excel file
        ↓
Preview shows what changed (new / updated / removed)
        ↓
Click "Import" → catalog updates instantly
```

---

## Tech Stack

| Layer | Tool | Cost |
|---|---|---|
| Frontend framework | Next.js 14 (App Router) | Free |
| Hosting | Vercel | Free tier |
| Cloud database | Supabase (PostgreSQL) | Free tier |
| Search | Supabase full-text search | Free (built-in) |
| Excel parsing | SheetJS (browser-side) | Free / open source |
| Version control | GitHub | Free |
| Future: Erply sync | Erply REST API | Already paying |
| Future: E-commerce | Stripe Checkout | 2.9% + 30¢ / transaction |

---

## Excel File Format

Your Excel file needs these columns. Column order doesn't matter. A downloadable template will be provided.

| Column Name | Required | Description |
|---|---|---|
| `SKU` | Yes | Unique ID per product (e.g. SHOE-001) |
| `Name` | Yes | Product display name |
| `Category` | Yes | Must match one of your defined categories |
| `Price` | Yes | Numeric, no $ sign (e.g. 29.99) |
| `Description` | No | Short product description |
| `Stock Qty` | No | Number in stock (defaults to 0 if blank) |
| `Image URL` | No | Direct link to a hosted product image |
| `Active` | No | TRUE or FALSE — hide a product without deleting it |

**Rules:**
- SKU is the unique key — re-uploading a row with the same SKU updates that product, not creates a duplicate
- Removing a row from the Excel and re-uploading marks that product as inactive (hidden from catalog), not deleted
- Category names must be consistent — "Footwear" and "footwear" are treated as different categories

---

## Phase 1 — Foundation
**Goal:** Define the data model and stand up the infrastructure.  
**Agents:** Agent 0 + Agent 0b — run in parallel  
**Blocks:** Nothing in Phase 2 starts until both are done.

---

### Agent 0 · Architect

**Mission:** Look at the actual Excel file, define the database schema from it, and document the column mapping.

**Inputs needed:**
- A sample Excel file (even a small one — 10+ rows is enough)
- The list of product categories used

**Deliverables:**
1. `docs/data-model.md` — every database table, column, data type, and constraint
2. `docs/field-mapping.md` — each Excel column → database column, with transformation notes (e.g., Price as string "29.99" → `price_cents` integer 2999)
3. `docs/categories.md` — canonical category list with slugs (e.g., "Footwear" → slug `footwear`)
4. Decision logged: which Excel columns map to the DB, which are ignored, any data cleaning needed

**Key questions to resolve:**
- Are there products with size/color variants? (affects schema complexity)
- Should price be visible on the public catalog?
- Are there products that should be hidden from the catalog but kept in inventory?
- Do any products have multiple images?

---

### Agent 0b · Infra Setup

**Mission:** Create the repo, Supabase project, and Vercel deployment so Phase 2 agents have a real environment.

**Deliverables:**
1. GitHub repository with this folder structure:
```
/
├── app/
│   ├── (catalog)/          # Public-facing catalog pages
│   │   ├── page.tsx        # Homepage / browse
│   │   ├── category/[slug]/page.tsx
│   │   └── product/[id]/page.tsx
│   ├── admin/              # Password-protected admin section
│   │   ├── page.tsx        # Admin dashboard
│   │   └── import/page.tsx # Excel upload page
│   └── api/
│       └── import/route.ts # Import API endpoint
├── components/             # Reusable UI components
├── lib/                    # Supabase client, utilities
├── docs/                   # Data model, field mapping (from Agent 0)
├── public/
│   └── template.xlsx       # Blank Excel template for importing
├── middleware.ts            # Admin route protection
├── .env.example
└── README.md
```
2. Supabase project created — URL and anon key documented in `.env.example`
3. Vercel project linked to GitHub — auto-deploys on push to `main`
4. `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_PASSWORD` (for the admin route)

---

## Phase 2 — Parallel Build
**Goal:** Build the database, admin import page, and catalog frontend simultaneously.  
**Agents:** Agent 1, Agent 2, Agent 3 — run in parallel after Phase 1 completes.

---

### Agent 1 · Database

**Mission:** Implement the schema in Supabase and make it query-ready.

**Depends on:** Agent 0's `data-model.md`

**Deliverables:**
1. SQL migration files in `/supabase/migrations/`
2. Tables:
   - `products` — id, sku, name, description, price_cents, category_id, stock_qty, is_active, image_url, created_at, updated_at
   - `categories` — id, name, slug, display_order
3. Row Level Security:
   - Public SELECT on `products` (where `is_active = true`) and `categories`
   - INSERT/UPDATE/DELETE restricted to service role key only
4. Indexes: full-text search on `(name, description)`, index on `category_id`, `sku`, `is_active`
5. Seed data: 20+ mock products across 4+ categories so Agent 3 can build against realistic data
6. Verified API queries work correctly:
   - List all active products
   - Filter by category slug
   - Full-text search
   - Single product by id or sku

---

### Agent 2 · Admin Import Page

**Mission:** Build the drag-and-drop Excel import page that updates the catalog.

**Depends on:** Agent 0b's repo structure + Agent 1's confirmed schema

**Deliverables:**

**`middleware.ts`** — protects all `/admin/*` routes:
- Checks for a session cookie containing the hashed `ADMIN_PASSWORD`
- Redirects to `/admin/login` if not authenticated
- No user accounts, no database — just a single env var password

**`/admin/login`** — simple login page:
- Password field
- On correct password: sets a secure httpOnly cookie, redirects to `/admin`

**`/admin`** — admin dashboard:
- Link to import page
- Last import timestamp and summary ("Last import: May 26 2026 — 47 products, 5 categories")
- Link to download the blank Excel template

**`/admin/import`** — the main upload page:
- Drag-and-drop zone (also accepts click-to-browse)
- Accepts `.xlsx` and `.xls` files
- Parses Excel client-side using SheetJS (no file upload to server — parsing happens in the browser)
- Shows a diff preview table before importing:
  - 🟢 Green rows = new products (will be inserted)
  - 🟡 Yellow rows = existing products with changes (will be updated)
  - 🔴 Red rows = products in DB but missing from Excel (will be deactivated)
  - ⚪ Gray rows = unchanged (will be skipped)
- Column validation: flags missing required columns, invalid price format, unknown categories, etc.
- "Confirm Import" button (disabled until preview loads with no critical errors)
- Progress indicator during import
- Success screen: "Import complete — 47 updated, 3 new, 1 deactivated"
- Error screen: shows which rows failed and why

**`/api/import` (POST)** — server-side import endpoint:
- Receives parsed rows as JSON
- Maps Excel columns → DB columns using field mapping from `docs/field-mapping.md`
- Upserts products (insert new, update changed, skip identical)
- Sets `is_active = false` for products not present in the upload
- Updates category table if new categories appear
- Returns: `{ inserted, updated, deactivated, skipped, errors[] }`

**`/public/template.xlsx`** — blank Excel template:
- Correct column headers
- One example row (can be deleted)
- Column headers are bold, locked row

---

### Agent 3 · Frontend (Public Catalog)

**Mission:** Build the complete public-facing catalog website.

**Depends on:** Agent 0b's repo + Vercel setup. Uses mock data until Agent 1 confirms schema is live.

**Pages:**
- `/` — catalog homepage: product grid, category filter, search bar
- `/category/[slug]` — filtered view for one category
- `/product/[id]` — full product detail page

**Components:**
- `ProductGrid` — responsive grid, adjusts columns by screen size
- `ProductCard` — image, name, price, stock badge, links to detail page
- `CategoryNav` — sidebar on desktop, tab strip on mobile; shows active state; updates URL
- `SearchBar` — debounced (300ms), updates grid without page reload, syncs with URL param
- `StockBadge` — "In Stock" / "Low Stock" (≤5) / "Out of Stock" visual pill
- `ProductDetail` — hero image, name, category breadcrumb, price, description, stock badge
- `Skeleton` — placeholder cards while data loads
- `EmptyState` — friendly message when search/filter returns nothing

**Requirements:**
- URL-driven state: `/category/footwear?q=nike` — search and category in URL, shareable links
- Mobile responsive: single column on phone, 2-col tablet, 3–4 col desktop
- Images: Next.js `<Image>` with graceful fallback for missing images
- Performance: catalog page loads under 2 seconds
- No auth, no cart, no checkout — fully public read-only

**Out of scope:**
- Cart / checkout
- User accounts
- Admin interface (handled by Agent 2)

---

## Phase 3 — QA & Launch
**Goal:** Import real data, test everything, go live.  
**Agent:** Agent 4  
**Depends on:** Agents 1 + 2 + 3 all complete

---

### Agent 4 · QA & Launch

**Mission:** Load real products, verify end-to-end, ship.

**Steps:**
1. Prepare a real Excel file from your current inventory (using the provided template)
2. Log into `/admin/import`, upload the file, confirm the preview looks correct, run import
3. Verify catalog reflects the real products

**Test checklist:**
- [ ] All products appear on homepage
- [ ] Category filters work correctly
- [ ] Search finds products by name and keyword
- [ ] Out-of-stock products show correct badge
- [ ] Product detail page shows all fields
- [ ] Images load or fall back gracefully
- [ ] Re-uploading updated Excel correctly shows diff (new/changed/removed)
- [ ] Deactivated products disappear from public catalog
- [ ] Admin login works, wrong password is rejected
- [ ] Mobile layout on iOS Safari + Android Chrome
- [ ] Lighthouse score: Performance > 80, no console errors
- [ ] Custom domain configured (if applicable)
- [ ] Vercel auto-deploy confirmed working

---

## Phase 4 — Future Upgrades
*Pick these up when ready. Nothing here blocks the launch.*

---

### Agent 5a · Erply Auto-Sync
**Trigger:** When Erply migration is complete and API credentials are available.

- Connect to Erply API, pull product/item list on a schedule
- Map Erply fields → database using the same upsert logic from Agent 2's `/api/import`
- Set up automated sync (every 15–30 min via Vercel cron or GitHub Actions)
- Admin page shows last sync time and status
- Manual "Sync Now" button on the admin dashboard
- Excel upload stays as a fallback / override option

---

### Agent 5b · E-Commerce (Stripe)
**Trigger:** When you decide to allow purchasing on the site.

**Decision point:** Stripe (custom, 2.9% + 30¢/transaction, full control) vs. Shopify ($39/mo, managed checkout, less dev work). Recommendation: Stripe if you have developer bandwidth; Shopify if you want it managed.

**Stripe scope:**
- Cart state (Zustand or React Context)
- "Add to Cart" on product cards + detail pages
- `/cart` page with quantity controls
- Stripe Checkout session (Next.js API route)
- Order confirmation page + receipt email
- Decide: sync orders back to Erply or manage in a separate orders table?

---

### Agent 5c · Admin Dashboard (expanded)
**Trigger:** Anytime after launch.

- Product list with inline edit (override description, image, display name without re-uploading)
- Import history log (date, who uploaded, summary of changes)
- Analytics: most-viewed products, search terms, traffic by category
- "Sync Now" button for Erply (Phase 5a)
- Order management view (Phase 5b)

---

## Dependency Map

```
Phase 1
├── Agent 0  (Architect)       ──────────────────────┐
└── Agent 0b (Infra Setup)     ────────────┐          │
                                            │          │
Phase 2                                     ▼          ▼
├── Agent 3  (Frontend)   ← needs repo (0b) + schema spec (0)
├── Agent 1  (Database)   ← needs schema spec (0)
└── Agent 2  (Admin Import) ← needs repo (0b) + confirmed schema (1)

Phase 3
└── Agent 4  (QA & Launch) ← needs 1 + 2 + 3 all done

Phase 4  (future, unblocked after launch)
├── Agent 5a (Erply Sync)  ← needs Erply credentials
├── Agent 5b (Commerce)    ← needs business decision
└── Agent 5c (Admin+)      ← can start anytime
```

---

## Timeline Estimate

| Phase | Effort | Blocker |
|---|---|---|
| Phase 1 — Foundation | 1 day | Need sample Excel file from you |
| Phase 2 — Parallel build | 3–4 days | Agents 1/2/3 run simultaneously |
| Phase 3 — QA & Launch | 1 day | Need real Excel from you |
| **Total to launch** | **~5–6 days** | |
| Phase 4a — Erply | 1–2 days | Erply migration must be done |
| Phase 4b — Commerce | 3–5 days | Business decision needed |
| Phase 4c — Admin+ | 2–3 days | No blocker |

---

## What You Need to Provide

**Before Phase 1:**
- [ ] A sample Excel file of your products (even partial — 10+ rows is fine)
- [ ] Your product category list (rough is fine)
- [ ] Whether prices are shown publicly on the catalog
- [ ] Whether you already have a domain name

**Before Phase 3 (launch):**
- [ ] Full inventory Excel in the provided template format
- [ ] Product images (or hosted image URLs, if any)

**Before Phase 4a (Erply sync):**
- [ ] Erply API credentials (client code + API key)
- [ ] Confirmation data is clean in Erply

---

## Key Principles

**The admin page is the bridge.** Until Erply is live, updating the catalog is a 30-second task: export Excel, drag onto admin page, confirm, done. No code, no command line.

**The website never touches your inventory system.** It is read-only. You manage inventory in Excel / Erply. The site just reflects it.

**Erply is a pipeline swap, not a rebuild.** When you're ready, Agent 5a replaces the manual upload with automatic polling. The database, frontend, and admin page are all unchanged.

**Free until scale.** Supabase free tier: 500MB / 50k requests per month. Vercel free tier: unlimited. GitHub: free. Zero recurring cost until Phase 4b (commerce) or significant traffic.
