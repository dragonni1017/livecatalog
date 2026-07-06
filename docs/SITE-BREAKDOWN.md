# L&Y USA Live Catalog — Site Breakdown

**Live site:** https://livecatalog.vercel.app  
**Last updated:** 2026-06-30

This document walks through every part of the website in plain English — what it does, how it works, and where it lives in the codebase. Use it as a reference when you want to understand, change, or explain any feature.

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [Public Catalog — Browsing](#2-public-catalog--browsing)
3. [Product Detail Page](#3-product-detail-page)
4. [Search & Autocomplete](#4-search--autocomplete)
5. [Cart](#5-cart)
6. [Checkout & Order Submission](#6-checkout--order-submission)
7. [Order Status Page (Customer)](#7-order-status-page-customer)
8. [Customer Accounts](#8-customer-accounts)
9. [Favorites](#9-favorites)
10. [Quick Order](#10-quick-order)
11. [Admin — Overview & Login](#11-admin--overview--login)
12. [Admin — Orders](#12-admin--orders)
13. [Admin — Products & Stock](#13-admin--products--stock)
14. [Admin — Import (Excel Upload)](#14-admin--import-excel-upload)
15. [Admin — Customers & Pricing](#15-admin--customers--pricing)
16. [Admin — Analytics](#16-admin--analytics)
17. [Admin — Price List](#17-admin--price-list)
18. [Admin — Sync (Erply)](#18-admin--sync-erply)
19. [Admin — Audit Log](#19-admin--audit-log)
20. [Admin — Zero Results Report](#20-admin--zero-results-report)
21. [Email Notifications](#21-email-notifications)
22. [Inventory Alerts](#22-inventory-alerts)
23. [Abandoned Cart Reminders](#23-abandoned-cart-reminders)
24. [Back-in-Stock Notifications](#24-back-in-stock-notifications)
25. [Infrastructure & Services](#25-infrastructure--services)

---

## 1. The Big Picture

The site is a **wholesale product catalog** for L&Y USA. It is not a store — no payments are taken online. Instead, customers browse products, build a cart, and **submit a quote request**. The team receives that request by email, reviews it in the admin dashboard, and keys it into QuickBooks Desktop.

**The flow in plain English:**

```
Customer visits the site
  → browses products by category or search
  → adds items to cart
  → fills out their name / email / company / PO number and submits
  → L&Y receives an email with the full order
  → customer gets a confirmation email with a reference code
  → admin reviews the order, marks it as entered in QuickBooks
```

**Product data** comes from an Excel file the admin uploads. There is also a built-in Erply integration that can replace the manual upload when ready.

---

## 2. Public Catalog — Browsing

**URL:** `/`  
**File:** `app/(catalog)/page.tsx`

The homepage is the main catalog. When you land on it you see:

- **Best Sellers** — a small section at the top showing the most-viewed products, pulled from the analytics tracking table.
- **Category navigation** — a sidebar on desktop, tabs on mobile. Every product category appears here. Clicking a category filters the grid to that category only.
- **Product grid** — all products displayed as cards (image, name, price, stock badge). Defaults to showing everything; narrows when you filter.
- **Search bar** — a text input in the header that filters by product name or SKU as you type.
- **Filters:**
  - Category (sidebar/tabs)
  - In-stock only toggle
  - Price range slider
- **Pagination** — products load in pages so the browser doesn't have to load 3,000 items at once.
- **Sort** — you can sort by name or price.

Each product card has an **Add to Cart** button and a **heart icon** to save to favorites.

**Category pages** also exist at `/category/[slug]` — these are the same grid filtered to one category, with their own URL so they can be linked directly.

**New Arrivals** has its own dedicated page at `/new-arrivals`.

---

## 3. Product Detail Page

**URL:** `/product/[id]`  
**File:** `app/(catalog)/product/[id]/page.tsx`

Clicking any product card opens its detail page. It shows:

- **Image gallery** — primary image large, with thumbnail strip for additional images. Multiple images per product are supported.
- **Product name and SKU**
- **Price** — shown per unit and per case (the pack quantity is parsed from the product name, e.g. "12/pk 5bx/cs cs.60" → $X per unit, $Y per case).
- **Description**
- **Barcode**
- **Stock badge** — In Stock / Low Stock / Out of Stock
- **Add to Cart** button — if out of stock, this becomes a **Notify Me** button (see Section 24).
- **Quote disclaimer** — a note that this is a quote request, not a direct purchase.
- **Related products** — "More in this category" shows other products in the same category.
- **Barcode scan** — a scan icon in the header lets you scan a product's barcode with your phone camera to jump straight to its page.

Pages are server-side rendered with **ISR caching** (revalidates every 10 minutes), so they load fast without being stale.

---

## 4. Search & Autocomplete

**Files:** `components/catalog/SearchBar.tsx`, `app/api/products/suggest/route.ts`, `app/api/products/lookup/route.ts`

There are two search behaviors:

**Autocomplete (typeahead):** As you type in the search bar, a dropdown appears after a short delay (debounced). Each suggestion shows the product image, name, SKU, and category. Clicking a suggestion goes directly to that product's page. This calls `/api/products/suggest`.

**Full search:** Pressing Enter or submitting the search filters the main catalog grid. Results match on product name and SKU.

**Barcode scan-to-search:** A camera icon in the header opens a barcode scanner. Point your phone camera at any product barcode — it reads the UPC and looks up the matching product. Calls `/api/products/lookup`.

Every search term is tracked (see Section 16 — Analytics) so you can see what customers are searching for. Searches that returned zero results are tracked separately (see Section 20).

---

## 5. Cart

**URL:** `/cart`  
**Files:** `app/(catalog)/cart/page.tsx`, `components/catalog/CartButton.tsx`

The cart is stored in **localStorage** in the browser, so it persists across page refreshes without needing a login. It holds each product's SKU, name, price, and quantity.

**Cart page features:**
- List of items with image, name, SKU, price per unit
- Quantity controls (increase / decrease / remove)
- Line totals and subtotal
- **Order minimum** — if the subtotal is below the minimum order amount, a warning shows and the checkout button is blocked
- **Save as draft** — saves the cart to the server so you can come back to it later (even from a different device if logged in)
- **Rush order flag** — a toggle to mark the order as rush / required-ship-date
- A note field for special instructions

The cart header badge shows item count and updates in real time as items are added from any product card or the quick order page.

---

## 6. Checkout & Order Submission

**URL:** `/cart` (checkout form is on the same page, below the cart)  
**Files:** `app/api/orders/route.ts`, `lib/order-validation.ts`, `lib/order-emails.ts`

When the cart is ready, the customer fills out the checkout form:

- **Name, email, company** (remembers these from the last visit)
- **Phone** (optional)
- **PO number** (optional, for buyers who need one on the order)
- **Shipping notes**
- **CC a sales rep** — an optional field to forward a copy of the confirmation email to a rep

Clicking **Submit Order**:
1. The order is validated server-side (minimum order check, required fields)
2. The order is saved to Supabase as an `order_request` with all line items snapshotted
3. A **notification email** goes to `sale@ly-usa.com` with the full order details
4. A **confirmation email** goes to the customer with a reference code (e.g. ORD-2026-0042) and a link to track their order
5. The cart is cleared
6. The customer is redirected to the order status page

**Sales rep pre-fill:** If a rep shares a link with `?rep=email@example.com` in the URL, the CC field is pre-filled automatically so the rep gets a copy of every order submitted through that link.

---

## 7. Order Status Page (Customer)

**URL:** `/order/[reference]`  
**File:** `app/(catalog)/order/[reference]/page.tsx`

Customers can check their order status at any time using the reference code from their confirmation email. The page shows:

- **Status badge** — Received → In Progress → Confirmed → Closed
- **Order items** — product list with quantities and prices
- **Subtotal**
- **Submitted date**
- **Reorder button** — adds all items from this order back to the cart in one click, useful for repeat orders

---

## 8. Customer Accounts

**URLs:** `/login`, `/register`, `/account`, `/account/settings`, `/my-orders`  
**Files:** `app/(catalog)/login/page.tsx`, `app/(catalog)/register/page.tsx`, `app/(catalog)/account/`, `lib/auth-client.ts`, `lib/auth-server.ts`

Customers can create an account with email + password. This is optional — you can submit orders without an account. Having an account gives you:

- **Order history** — `/my-orders` shows all past orders matched by email
- **Profile** — name, company, phone stored in your account
- **Settings** — edit profile info at `/account/settings`
- **Saved cart / draft** — your saved draft cart is tied to your account

Authentication is handled by **Supabase Auth** (email/password). The login page also has a forgot-password flow — Supabase sends a reset link to the customer's email.

---

## 9. Favorites

**URL:** `/favorites`  
**File:** `app/(catalog)/favorites/page.tsx`

The heart icon on any product card saves it to your favorites list. Favorites are stored in localStorage (no login required). The `/favorites` page shows all saved products in the same grid layout as the main catalog. You can add them to cart from the favorites page directly.

---

## 10. Quick Order

**URL:** `/quick-order`  
**File:** `app/(catalog)/quick-order/page.tsx`

A faster way to build a cart for buyers who already know what SKUs they want. Two input methods:

**Manual SKU entry:** Type a SKU into the input, set a quantity, and click Add. Looks up the product by SKU and adds it to cart instantly.

**CSV upload:** Upload a CSV file with two columns — SKU and quantity. The page validates each row, shows a preview of matched products, and lets you add all valid items to cart in one click. Useful for reps who prepare orders offline.

---

## 11. Admin — Overview & Login

**URL:** `/admin`  
**Files:** `app/admin/login/page.tsx`, `app/admin/page.tsx`, `app/admin/2fa-setup/page.tsx`

The admin section is completely separate from the public catalog. Access requires:

1. **Email + password login** — each staff member has their own Supabase Auth account with `role: admin` in their profile metadata
2. **2FA (optional but available)** — `/admin/2fa-setup` lets any admin set up a TOTP authenticator app (Google Authenticator, Authy, etc.)

The admin homepage (`/admin`) is a dashboard overview linking to all the admin sections. The sidebar shows: Orders, Products, Import, Customers, Analytics, Price List, Sync, Audit Log, Zero Results, Reps, Users.

---

## 12. Admin — Orders

**URL:** `/admin/orders`  
**Files:** `app/admin/orders/page.tsx`, `app/admin/orders/[id]/page.tsx`, `app/admin/api/orders/route.ts`

The orders list shows every quote request submitted through the site. You can:

- **Search** by customer name, email, or reference code
- **Filter** by status (New / Contacted / Converted / Lost) and by whether it's been entered in QuickBooks
- **Click an order** to see the full detail page

**Order detail page** (`/admin/orders/[id]`) shows:
- Customer info (name, email, phone, company)
- PO number and sales rep
- Full item list with quantities and prices
- Buyer discount (if the customer has a custom pricing tier) and discounted subtotal
- **Status dropdown** — update the order through its stages
- **Entered in QuickBooks toggle** — check this off once it's been keyed in; shows timestamp and who toggled it
- **Print Sales Order** — opens a print-ready PDF version of the order (`/admin/orders/[id]/print`)
- **Excel export** — downloads the order as an Excel file for QuickBooks import (`/admin/api/orders/[id]/excel`)
- **Packing slip** — a separate print view formatted as a packing slip (`/admin/orders/[id]/packing-slip`)
- **Customer view link** — opens the same order status page the customer sees, so you can verify it looks right

**Bulk CSV export:** `/admin/api/orders/export` downloads all orders as a CSV for reporting.

---

## 13. Admin — Products & Stock

**URL:** `/admin/products`  
**Files:** `app/admin/products/page.tsx`, `app/admin/api/products/route.ts`, `app/admin/api/stock/route.ts`, `app/admin/api/stock/bulk/route.ts`

The products page is a full list of every product in the catalog with search and filters. From here you can:

**Filters:**
- Search by name or SKU
- Filter by category
- Filter by visibility (visible / hidden)
- Filter by active/inactive status

**Per-product actions (inline):**
- **Edit** — click to edit the product name, description, or image URL inline (no separate page)
- **Stock adjustment** — add or remove units with a reason note (e.g. "received shipment", "damaged"). Every adjustment is logged.
- **Hide/show toggle** — manually hide a product from the catalog without deactivating it. Useful for temporarily removing something.
- **Per-product reorder threshold** — set a custom low-stock alert level per product (overrides the global default of 5 units)

**Bulk stock adjustment:** Check multiple products and use the sticky bar at the bottom to adjust stock on all of them at once. Useful after a warehouse count.

---

## 14. Admin — Import (Excel Upload)

**URL:** `/admin/import`  
**Files:** `app/admin/import/page.tsx`, `app/api/import/route.ts`, `app/api/import/diff/route.ts`

This is how product data gets into the catalog. The admin drags and drops an Excel file onto the import page. The file is parsed in the browser (no upload needed for the preview step).

**The import flow:**

1. **Drop the file** — the page immediately parses it and shows a diff preview
2. **Diff preview** — shows exactly what will change: new products (green), updated products (yellow), deactivated products (red — SKUs in the DB that are no longer in the file), and unchanged products (skipped)
3. **Review and confirm** — you see the count of each type before committing
4. **Click Import** — sends the parsed data to the server, which upserts products into Supabase

**Excel format expected:**

| Column | Required | Notes |
|---|---|---|
| SKU | Yes | Unique key — re-uploading same SKU updates, never duplicates |
| Name | Yes | Product display name |
| Category | Yes | Must match exactly — "Footwear" ≠ "footwear" |
| Price | Yes | Numeric, no $ sign |
| Description | No | Short product description |
| Stock Qty | No | Defaults to 0 if blank |
| Image URL | No | Direct link to hosted image |
| Active | No | TRUE/FALSE — hide without deleting |

**Import history:** `/admin/imports` shows a log of every past import with row counts (inserted / updated / deactivated / errors).

A download link for the template Excel file is available in the UI (at `/public/template.xlsx`).

---

## 15. Admin — Customers & Pricing

**URL:** `/admin/customers`  
**Files:** `app/admin/customers/page.tsx`, `app/admin/customers/CustomerTable.tsx`, `app/admin/api/customers/route.ts`

The customers page manages buyer accounts and custom pricing. Every registered customer (or any customer who has placed an order) appears here.

**Per-customer fields:**
- Name, email, company, phone
- **Discount percent** — set a custom discount for this buyer (e.g. 10% off all orders). When a customer with a discount places an order, the order detail page in admin shows both the standard subtotal and the discounted subtotal side by side.
- Notes

This is the foundation for tier-based pricing. A buyer at 15% discount sees the same prices on the catalog as everyone else, but their order confirmation shows the discounted total.

---

## 16. Admin — Analytics

**URL:** `/admin/analytics`  
**File:** `app/admin/analytics/page.tsx`

A dashboard showing how the catalog is being used. Everything here is pulled from the `analytics_events` table in Supabase, which records product views and search terms automatically.

**What's tracked:**
- Every product detail page view (fires via `/api/track` on page load)
- Every search term typed (fires on debounced input)

**Dashboard sections:**
- **Date range filter** — switch between 7D / 30D / 90D / All time
- **Orders over time** — bar chart of how many orders were submitted per day over the selected period
- **Summary stats** — total orders, total quote value, conversion rate (views → orders)
- **Most viewed products** — ranked list of which products get the most traffic
- **Top search terms** — what customers are searching for most

---

## 17. Admin — Price List

**URL:** `/admin/price-list`  
**File:** `app/admin/price-list/page.tsx`

A printable wholesale price list — all products with their prices, organized by category. You can filter by category before printing. Designed to be printed as a PDF handout for trade shows or sales calls.

---

## 18. Admin — Sync (Erply)

**URL:** `/admin/sync`  
**Files:** `app/admin/sync/page.tsx`, `app/admin/api/sync/route.ts`, `lib/erply.ts`, `lib/product-sync.ts`

L&Y USA uses **Erply** as their inventory management system. This page is where the Erply integration lives. When it's activated, it replaces the manual Excel import — products sync automatically from Erply into the catalog.

**Current status:** Built and ready, but **not yet activated**. Erply data needs to be cleaned up on the Erply side before the sync can be turned on. Once activated:

- A **daily cron job** (8am) triggers the sync automatically
- The sync page lets you **manually trigger a sync** and see its status
- A webhook endpoint at `/api/webhooks/erply` can receive real-time updates from Erply

There is also a `/api/webhooks/woo` endpoint for WooCommerce webhooks (for future use).

---

## 19. Admin — Audit Log

**URL:** `/admin/audit-log`  
**File:** `app/admin/audit-log/page.tsx`, `lib/audit.ts`

Every significant action in the admin leaves a record in the audit log. This includes:

- Stock adjustments (who changed what, by how much, and why)
- Order status changes (who moved an order from New → Contacted, etc.)
- QuickBooks "entered" toggles (who marked it, when)

Each entry shows: action type, what was changed, old value → new value, who did it, and when.

---

## 20. Admin — Zero Results Report

**URL:** `/admin/zero-results`  
**File:** `app/admin/zero-results/page.tsx`

Shows every search term that was typed into the catalog but returned **zero products**. This is useful for spotting:

- Products customers want that aren't in the catalog yet
- Misspelled category or product names
- SKUs customers are searching for that have been deactivated

---

## 21. Email Notifications

**Files:** `lib/email.ts`, `lib/order-emails.ts`  
**Email provider:** Titan Mail SMTP (via nodemailer, included with L&Y's domain)

The site sends several types of automated emails:

| Trigger | Recipients | Content |
|---|---|---|
| New order submitted | `sale@ly-usa.com` (+ optional CC rep) | Full order details — customer info, all items, quantities, prices, subtotal |
| New order submitted | Customer | Confirmation with reference code + link to order status page |
| Order status change | Customer | Notification that their order moved to a new stage |
| Low stock | `sale@ly-usa.com` | Which products have dropped to/below their threshold |
| Back in stock | Subscribers | Products they requested notification for are back in stock |
| Abandoned cart | Customer | Reminder that they have items in their cart (24-hour delay) |

---

## 22. Inventory Alerts

**Files:** `lib/low-stock-alert.ts`

When a product's stock drops to or below its threshold, a low-stock alert email is sent to `sale@ly-usa.com`. 

**How it triggers:**
- On every Excel import (checked after the import runs)
- On the daily cron job at 8am (catches any changes that happened outside imports)
- On manual stock adjustments in the admin

**De-duplication:** Each product only alerts once per "restock cycle." Once a product gets the low-stock alert, it won't alert again until it's been restocked above the threshold and then drops below again. This prevents email spam if the same product stays low for days.

**Thresholds:** The default threshold is 5 units. Each product can have its own custom threshold set in the admin products page.

---

## 23. Abandoned Cart Reminders

**File:** `lib/abandoned-cart.ts`, `app/api/cart-session/route.ts`

When a customer starts a checkout but doesn't finish, the site saves their cart server-side as a "cart session" (keyed by email if they've typed it). After 24 hours with no order submitted, an automated email goes out reminding them they have items waiting. The email links back to the site with a note about what's in their cart.

---

## 24. Back-in-Stock Notifications

**File:** `lib/back-in-stock-notify.ts`, `app/api/back-in-stock/route.ts`

On any out-of-stock product detail page, the "Add to Cart" button is replaced by a **Notify Me** form. The customer types their email and submits. Their request is saved to the `back_in_stock_requests` table.

When a product is restocked (via import or manual stock adjustment) and crosses back above zero, the system automatically emails all subscribers for that product. The email is sent once per subscriber and the request is marked as notified so they don't get duplicate emails.

---

## 25. Infrastructure & Services

**Hosting — Vercel**  
The app is deployed on Vercel. Every push to the main branch triggers an automatic deployment. The production URL is `https://livecatalog.vercel.app`. A custom domain (`lyusacatalog.com`) is ready to be pointed here once purchased.

**Database — Supabase (PostgreSQL)**  
All data lives in Supabase: products, categories, orders, customers, analytics, audit log, cart sessions, back-in-stock requests, stock adjustments. Row Level Security (RLS) is enabled on all tables — public routes can only read active products; admin reads and writes use a service-role key kept server-side.

**Images — Cloudinary**  
Product images are hosted on Cloudinary. The `lib/image.ts` helper generates responsive image URLs (resize, crop, format conversion) on the fly using Cloudinary's URL API. Images are referenced in the database by their Cloudinary URL; the catalog never stores images itself.

**Authentication — Supabase Auth**  
Two separate auth flows:
- **Customer accounts** — email/password, handled by Supabase Auth directly (`lib/auth-client.ts`, `lib/auth-server.ts`)
- **Admin** — also Supabase Auth, but requires `role: admin` in the user's `app_metadata`; enforced in middleware

**Daily Cron — Vercel Cron**  
A cron job runs every day at 8am and triggers two things: the Erply sync (when activated) and the low-stock check. Configured in `vercel.json`.

**Excel Parsing — SheetJS**  
The `xlsx` npm package (SheetJS) is used for all Excel reading and writing: parsing the import file in the browser, generating per-order Excel exports, and generating bulk CSV exports.

**Pack Quantity Parsing — `lib/pack.ts`**  
Product names follow a standard format like `"Foam Hearts - 12/pk 5bx/cs cs.60"`. The `lib/pack.ts` utility parses this string to extract pack size, boxes per case, and case quantity — used to display the per-case price alongside the per-unit price on product pages.

**Catalog Access Gate**  
A dormant feature — the entire public catalog can be put behind an access code (like a password for the storefront). Built and ready; activate by setting the `CATALOG_ACCESS_CODE` environment variable on Vercel.
