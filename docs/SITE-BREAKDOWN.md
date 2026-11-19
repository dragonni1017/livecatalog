# L&Y USA Live Catalog — Site Breakdown

**Live site:** https://lyusa.app (underlying Vercel deployment: https://livecatalog.vercel.app)  
**Last updated:** 2026-11-19 (checked against the code; sections 1-2, 5-8, 10-15, 17-18 and 21-25 rewritten, section 26 added)

This document walks through every part of the website in plain English — what it does, how it works, and where it lives in the codebase. Use it as a reference when you want to understand, change, or explain any feature.

For step-by-step staff instructions (which buttons to click, what can't be undone), see the in-app guide at `/admin/guide` (`lib/admin-guide.ts`).

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
26. [Admin — Other Screens](#26-admin--other-screens)

---

## 1. The Big Picture

The site is a **wholesale product catalog** for L&Y USA. It is not a store — no payments are taken online. Instead, customers browse products, build a cart, and **submit a quote request**. The team receives that request by email, follows up in the admin dashboard, and when the customer agrees marks it **Converted**, which sends it to QuickBooks Desktop automatically.

**The flow in plain English:**

```
Customer visits the site
  → browses products by category or search
  → adds items to cart (out-of-stock items come through as backorders)
  → fills out name / email / ship-to address (+ optional PO number) and submits
  → the sales inbox gets an email with the full order
  → customer gets a confirmation email with a reference code and a tracking link
  → staff follow up and set the status: Contacted → Converted (or Lost)
  → Converted takes the stock out and queues the order for QuickBooks
  → the QuickBooks Web Connector creates the Sales Order (about every 15 minutes)
```

**Product data** comes from **Erply** (the inventory system). A nightly sync copies names, prices, stock and active/inactive status into the catalog (Section 18). Photos, categories and descriptions are kept in the catalog itself. New container stock comes in through **Receiving** (Section 26); an Excel import (Section 14) is still available for one-off edits.

---

## 2. Public Catalog — Browsing

**URL:** `/`  
**File:** `app/(catalog)/page.tsx`

The homepage is the main catalog. When you land on it you see:

- **Category navigation** — a sidebar on desktop (New Arrivals, Best Sellers, All Products, then each department with its product count), tabs on mobile. Clicking a category filters the grid to that category only.
- **Shop by department** — photo tiles for each department.
- **Product grid** — every visible product as a card (image, name, price, stock badge, quantity stepper, **Add**, **+ 1 case**).
- **Search bar** — in the header; see Section 4.
- **Filters:** price **Min / Max** with **Apply**, **In stock only**, **Sold by**, **Case size**, **Sort** (default SKU A–Z), and **Show** N per page.
- **Pagination** — the grid is paged (20 per page by default; about 1,100 visible products as of 2026-11).

Only products that are **active** and **not hidden** appear anywhere on the public site (Section 13).

**Category pages** also exist at `/category/[slug]`, and **New Arrivals** and **Best Sellers** have their own pages (`/new-arrivals`, `/best-sellers`).

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
- **Add to Cart** and **+ 1 case** buttons. Out-of-stock products can still be added; the button reads **Backorder** and the line is flagged as a backorder. A **Notify me** box also appears on sold-out products (see Section 24).
- **Save** (heart) — adds the product to the **Saved** list (Section 9).
- **Quote disclaimer** — a note that this is a quote request, not a direct purchase.
- **Related products** — "More in this category" shows other products in the same category.
- **Barcode scan** — a scan icon in the header lets you scan a product's barcode with your phone camera to jump straight to its page.

Pages are server-side rendered with **ISR caching** (revalidates every 10 minutes), so they load fast without being stale.

---

## 4. Search & Autocomplete

**Files:** `components/catalog/SearchInput.tsx`, `app/api/products/suggest/route.ts`, `app/api/products/lookup/route.ts`

There are two search behaviors:

**Autocomplete (typeahead):** As you type in the search bar, a dropdown appears after a short delay (debounced). Each suggestion shows the product image, name, SKU, and category. Clicking a suggestion goes directly to that product's page. This calls `/api/products/suggest`.

**Full search:** Pressing Enter or submitting the search filters the main catalog grid. Results match on product name and SKU.

**Barcode scan-to-search:** A camera icon in the header opens a barcode scanner. Point your phone camera at any product barcode — it reads the UPC and looks up the matching product. Calls `/api/products/lookup`.

Every search term is tracked (see Section 16 — Analytics) so you can see what customers are searching for. Searches that returned zero results are tracked separately (see Section 20).

---

## 5. Cart

**URL:** `/cart`  
**Files:** `app/(catalog)/cart/page.tsx`, `components/catalog/CartButton.tsx`

The cart is stored in **localStorage** in the browser, so it persists across page refreshes without needing a login. It holds each product's SKU, name, price, and quantity. The page is titled **Your Order Request**.

**Cart page features:**
- List of items with image, name, SKU, price per unit, and badges such as **Backorder** or **Custom price** (rep-set, Section 6)
- Quantity controls (− / + / ✕ to remove)
- Line totals and subtotal; prices are re-checked against the server (`/api/cart/reprice`), so a signed-in customer sees their own tier price
- **Unavailable lines** — a product that has since been hidden, deactivated or left at $0 shows "No longer available. It won't be included in your request." with a **Remove** button, and isn't counted in the total
- **Quote and shipping notice** above the form: no payment is taken, and shipping isn't included — it's calculated and charged on a separate bill (`SHIPPING_NOTE` in `lib/order-rules.ts`, repeated in the confirmation email)
- **Promo code** box with **Apply**
- **Estimated sales tax** once a state is chosen (an estimate only; QuickBooks charges the real tax)
- **Order minimum** — `MIN_ORDER_SUBTOTAL_CENTS` in `lib/order-rules.ts`, currently **$0** (off). If raised, the cart says "Minimum order is $X" and blocks submit
- **Save as draft / Load draft…** — drafts are kept in that **browser only** (localStorage), not on the server or the account

The cart header badge shows item count and updates in real time as items are added from any product card or the quick order page.

---

## 6. Checkout & Order Submission

**URL:** `/cart` (checkout form is on the same page, below the cart)  
**Files:** `app/api/orders/route.ts`, `lib/order-validation.ts`, `lib/order-emails.ts`

When the cart is ready, the customer fills out the checkout form (pre-filled from their last order, with a **Clear** link):

- **Required:** Name, Email, Ship to — address, City, State, ZIP
- **Optional:** Phone, Company, **Placed by (rep)** (a dropdown of active reps), **CC sales rep (email)**, PO number, Address line 2, Notes, **Ship by date**
- Signed-in buyers can also pick a saved address or save this one to their address book
- The email box suggests fixes for common typos ("Did you mean …?")

Clicking **Submit Order Request**:
1. The order is validated server-side (required fields, minimum). Prices are **re-computed on the server**; the cart's prices are never trusted.
2. Products that are inactive, hidden or $0 are **dropped**. Out-of-stock products are **kept** and recorded as backorders (`lib/order-submission.ts`).
3. Pricing, in order: a **rep's selected tier**; otherwise the **customer's own tier or discount**, only when signed in with the same email as the order (Section 15); then the **promo code**, applied per line only where it beats the tier price (never stacked). Rep **custom prices** (above $0 only) are left as set.
4. The order is saved as an `order_request` with all line items snapshotted, and gets a reference code such as **ORD-2026-0042** (rep orders with a tier get a tier tag, e.g. ORD-2026-DIS-0042).
5. An **owner** is assigned: the rep the order is credited to, otherwise the owner of this customer's previous order, otherwise Unassigned.
6. A **notification email** goes to the sales inbox (`SALES_ALERT_TO`, being switched to `sales@ly-usa.com`) with the full order. Replying to it goes straight to the customer.
7. A **confirmation email** goes to the customer with the reference code and a tracking link; reps named in Placed by / CC are copied.
8. The cart is cleared and the page shows **Request received** with the reference code and **Continue browsing**.

**Sales rep links:** a link with `?rep=email@example.com` is remembered in the browser and pre-selects that rep in **Placed by (rep)**, if it matches an active rep.

**Rep ordering:** a signed-in rep picks a tier from the **Tier…** menu in the header and can set a **Custom price for this order** on any line (must be more than $0). The order is linked to the rep's account (for `/rep/quotes`) only when a tier was picked.

---

## 7. Order Status Page (Customer)

**URL:** `/order/[reference]`  
**File:** `app/(catalog)/order/[reference]/page.tsx`

Customers open this page from the **Track your order status** link in their confirmation email. The link carries a secret token (`?t=…`); the reference code alone isn't enough. It also opens for someone signed in with the order's email, the rep who placed it, or an admin. Anyone else sees "Sign in to view this order" (`lib/order-access.ts`).

The page shows:

- **Status badge** — Received → In Progress → Confirmed → Closed (admin statuses New → Contacted → Converted → Lost), plus **Entered in our system** once it's in QuickBooks
- **Order items** — product list with quantities, prices and backorder flags
- **Subtotal** and **Submitted date**
- **Print** and **Reorder all items** (adds the same items back to the cart)
- **Have a question about this order?** — a message box with **Send message**. The message is emailed to the sales inbox (`/api/order-reply`, subject "Customer message — ORD-…"); replying goes straight to the customer. It isn't saved on the order.

---

## 8. Customer Accounts

**URLs:** `/login`, `/register`, `/account`, `/account/settings`, `/my-orders`  
**Files:** `app/(catalog)/login/page.tsx`, `app/(catalog)/register/page.tsx`, `app/(catalog)/account/`, `lib/auth-client.ts`, `lib/auth-server.ts`

Customers can create an account with email + password (**Login** in the header → **Create one**). This is optional — you can submit orders without an account, and there's **no approval step**: everyone sees the standard prices. Having an account gives you:

- **Your own prices** — if an admin has given your email a price tier in Customer Profiles (Section 15). The header then shows "<Tier> pricing". Matching is **by email only**: registering doesn't create a customer profile, and signing in with a different email gives standard prices.
- **Order history** — `/account` and `/my-orders` list past orders matched by email, with **Reorder**
- **Profile** — edit at `/account/settings`; **saved addresses** — the address book on `/account`, offered at checkout
- **Resale certificate** — upload on `/account` (state + PDF/JPG/PNG). Once staff **verify** it, orders shipping to that state show $0 estimated tax (`lib/sales-tax.ts`); a pending one is flagged on the order. Reminder emails go out before it expires.
- **Net terms** — anyone (signed in or not) can apply via **Apply for net terms →** in the footer (`/credit-application`). Staff approve or decline in admin; approval records the terms and emails the applicant but doesn't change pricing or QuickBooks.

Authentication is handled by **Supabase Auth** (email/password). The login page also has a forgot-password flow — Supabase sends a reset link to the customer's email.

---

## 9. Favorites

**URL:** `/favorites`  
**File:** `app/(catalog)/favorites/page.tsx`

The heart icon on any product card saves it to your favorites list. Favorites are stored in localStorage (no login required). The **Saved** link in the header (with a count) opens `/favorites`, which shows all saved products in the same grid layout as the main catalog. You can add them to cart from the favorites page directly.

---

## 10. Quick Order

**URL:** `/quick-order`  
**File:** `app/(catalog)/quick-order/page.tsx`

A faster way to build a cart for buyers who already know what SKUs they want. Two input methods:

**SKUs box:** paste one SKU per line with an optional quantity after it (`ABC-123 24`; default 1) and click **Add all to cart**. The result lists what was added, any SKUs **Not found**, and anything added beyond stock (backordered), with a **View cart →** link.

**Upload CSV:** drop or browse for a CSV with two columns — SKU, Qty (one per row, max 50). Each row shows whether it matched before you add them. Useful for reps who prepare orders offline.

---

## 11. Admin — Overview & Login

**URL:** `/admin`  
**Files:** `app/admin/login/page.tsx`, `app/admin/page.tsx`, `app/admin/2fa-setup/page.tsx`

The admin section is completely separate from the public catalog. Access requires:

1. **Email + password login** — each staff member has their own Supabase Auth account with `role: admin` in their profile metadata
2. **2FA (optional but available)** — `/admin/2fa-setup` lets any admin set up a TOTP authenticator app (Google Authenticator, Authy, etc.)

The admin homepage (`/admin`, "Admin Dashboard") is a grid of cards; there is no sidebar. At the top: **Waiting on people** (everything that needs someone, oldest first), **Catalog health**, and **How to use the admin** (`/admin/guide`, the printable staff guide). Some cards only appear when there's work waiting (Price review, Name review, Case-count review, Needs follow-up). The rest are always shown, from Order Requests and Customer Profiles through to QuickBooks Setup (see Section 26 for the less obvious ones).

Sales reps sign in separately at `/rep/login` and get a **Rep Account** page (`/rep`) with Browse catalog, My quotes (`/rep/quotes`), Line card PDF and 2FA setup.

---

## 12. Admin — Orders

**URL:** `/admin/orders`  
**Files:** `app/admin/orders/page.tsx`, `app/admin/orders/[id]/page.tsx`, `app/admin/api/orders/route.ts`

The orders list ("Order Requests") shows every quote request submitted through the site. You can:

- **Needs follow-up** — New, non-dismissed orders only, oldest first (`?view=followup`; also the dashboard card)
- **Search** by customer name or reference code
- **Filter** by status (New / Contacted / Converted / Lost), by QuickBooks (not entered / entered), and **Show dismissed**
- See an **age badge** on New orders ("Waiting Nd"): amber after 1 business day, red after 3 (Mon–Fri, LA time; `lib/order-age.ts`)
- See hints for likely duplicates ("Same customer sent ORD-… later")
- Toggle **Mark QB / ✓ QB** per row, and open **Print ↗** / **Excel** per row
- **Export CSV** of all orders

**Order detail page** (`/admin/orders/[id]`) shows customer info (with placed-by rep, promo code, price tier, resale certificate and a warning if it ships to a different state), PO number, ship-to, notes, line items with backorder badges, subtotal and tax estimate, and a **+ Save to customer profiles** shortcut. An amber **Buyer Discount on File** box means a flat discount that must be applied in QuickBooks by hand. Order lines **can't be edited** in admin.

Actions:
- **Status buttons — New / Contacted / Converted / Lost.** Each saves immediately and emails the customer (except New):
  - **Contacted** — "Update on your order" (someone will be in touch)
  - **Converted** — "Your order is confirmed", and, **once per order, ever**: takes each line's quantity out of stock and queues the order for QuickBooks. Changing the status back afterwards doesn't undo either.
  - **Lost** — "Regarding your order request" (can't be fulfilled)
- **Close, no email** (Needs follow-up view) — set Contacted / Lost / Converted (asks twice) / Duplicate without emailing the customer
- **Owner (follows up)** — assign a rep or Unassigned; no email
- **Test / duplicate / spam → Dismiss** — New orders not yet in QuickBooks only; hides it from the waiting counts, no email, can be undone
- **Mark entered in QB / In QuickBooks ✓** — manual flag (also set automatically by the Web Connector); makes "Entered in our system" show to the customer
- **Customer view ↗**, **Excel**, **Packing slip ↗**, **Sales order ↗** (printable) — for checking or keying by hand

### QuickBooks Desktop (Web Connector)

**Files:** `app/api/qbwc/route.ts`, `lib/qbxml.ts`, `app/admin/quickbooks/`, `components/admin/QbSyncErrors.tsx`

Converted orders go into QuickBooks automatically. The QuickBooks Web Connector on the office PC (set up once from **QuickBooks Setup** → **Download .qwc file**) checks in about every 15 minutes and, for the oldest queued order:

1. Finds the QuickBooks customer — a saved link first, then an exact email or name match from the pulled customer list. A near-miss or several matches puts the order **on hold for review**; no match at all creates a new QuickBooks customer.
2. Finds each item by SKU, creating any missing item.
3. Sends a **Sales Order** (memo: reference, promo, tax estimate, notes; PO number; each line notes the ordered price). Sales tax is not sent — QuickBooks computes it.

On success the order is marked entered in QuickBooks. On failure it is marked failed and its status **reverts from Converted to New** (the customer has already had the "confirmed" email, and the stock was already taken out). Problems are listed at the bottom of `/admin/quickbooks`:

- **Possible existing customer** — pick the match, or **Not a match — create new**
- **Failed syncs** — fix the cause, then **Retry** (never retried automatically)
- **Stuck syncs** — sent but never confirmed: check QuickBooks first, and **Force retry** only if the order isn't there (otherwise you get a duplicate Sales Order)

Helper screens: `/admin/quickbooks/customers` (**Pull from QuickBooks**, then link buyers' emails to existing QuickBooks customers to avoid duplicates) and `/admin/quickbooks/items` (pulls the QuickBooks item list, used when naming new container SKUs).

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

**Per-product actions:**
- **Edit** — opens an "Edit product" box: name, categories (more than one allowed), price, priced per, description, primary image (URL or **Attach file**), additional images, and volume pricing tiers. **Save changes** is audit-logged. Category, description and photos stick; **name and price are put back by the next Erply sync** unless the price has a Price review hold (Section 18).
- **Adjust stock** — quantity and reason, **+ Add** / **− Remove**, with a history. Every adjustment is logged.
- **Visible / Hidden** pill — hides a product from the catalog without deactivating it (`manually_hidden`)
- **Threshold** — a per-product low-stock level ("Global" uses the default)
- **Delete** — permanent, but a product that's still in Erply or a later Excel file comes back
- **Add product** (top right) — creates a product in the catalog only, not in Erply, so the next sync may deactivate it

**Bulk stock adjustment:** tick rows, choose **Adjust by** or **Set to**, enter an amount and **Apply**. Useful after a warehouse count.

**Low-stock email on/off** switch is on this page (Section 22).

**Why a product isn't on the website:** it is **inactive** (missing from or deactivated in Erply), or **hidden** — by hand, automatically for a $0 price, by the dashboard's **Hide all products without an image** (no confirm, no undo-all), or because it came in from Receiving (new products arrive hidden, at $0, flagged needs-photo). A missing photo alone doesn't hide a product.

**$0 rules** (`lib/visibility-guard.ts`): a $0 product can't be unhidden, a visible product can't be set to $0, and the sync hides products whose price drops to $0. Put products back on the site with the pill, **Catalog Cleanup → Needs pricing → Unhide**, or **Show these?** (Section 26).

---

## 14. Admin — Import (Excel Upload)

**URL:** `/admin/import`  
**Files:** `app/admin/import/page.tsx`, `app/admin/api/import/route.ts`, `app/admin/api/import/diff/route.ts`

Since Erply became the source of product data (Section 18), the Excel import is for **one-off partial edits**. The admin drags and drops an Excel file onto the import page. The file is parsed in the browser (no upload needed for the preview step).

**The import flow:**

1. **Drop the file** ("Drag & drop your Excel file here") — the page parses it and shows a preview
2. **Preview** — new and updated products, with any issues per row
3. **Confirm Import (N rows)** or **Cancel**

**What it changes** (`app/admin/api/import/route.ts`): name, price and Active for every SKU in the sheet. Description and category are set **only for new products**. A blank Image URL or Stock Qty keeps the existing value, and Stock Qty is ignored for SKUs Erply counts. **Nothing missing from the sheet is deactivated.** Names and prices imported this way are still overwritten by the next Erply sync.

**Excel format expected:**

| Column | Required | Notes |
|---|---|---|
| SKU | Yes | Unique key — re-uploading same SKU updates, never duplicates |
| Name | Yes | Product display name |
| Category | Yes | Must match exactly — "Footwear" ≠ "footwear" |
| Price | Yes | Numeric, no $ sign |
| Description | No | Short product description |
| Stock Qty | No | Blank keeps the current value; ignored for SKUs Erply counts |
| Image URL | No | Direct link to hosted image; blank keeps the current one |
| Active | No | TRUE/FALSE — hide without deleting |

**Import history:** `/admin/imports` shows a log of every past import with row counts (inserted / updated / deactivated / errors).

A download link for the template Excel file is available in the UI (at `/public/template.xlsx`).

---

## 15. Admin — Customers & Pricing

**URL:** `/admin/customers`  
**Files:** `app/admin/customers/page.tsx`, `app/admin/customers/CustomerTable.tsx`, `app/admin/api/customers/route.ts`

"Customer Profiles" manages buyer pricing. A profile is **not** created when someone registers or orders; an admin adds it with **Add customer** (or **+ Save to customer profiles** on an order), before or after the buyer signs up. Matching is by **email**.

**Per-customer fields:** email (required, must be the one they sign in with), name, company, **Price Tier**, notes. Edit inline with **Edit** on the row. (A flat `discount_percent` column still exists but can't be set from the Add form.)

**Price tiers** (`price_tiers` table, values from migration 0032; the stored base price is the Wholesale price):

| Tier | Price |
|---|---|
| Wholesale | base price |
| Distribution Chain | 8% off |
| Exclusive | 24% markup |
| Retail | 2× (100% markup) |

**How it applies** (`lib/customer-pricing.ts`, the one place that decides): an active tier wins, otherwise the flat discount, never both. A signed-in customer with a tier sees tier prices while browsing (header badge "<Tier> pricing"), in the cart and on the order. A flat discount shows in the cart and on the order but not while browsing. Orders only get customer pricing when the buyer is **signed in with the order's email**. A rep's tier choice overrides the customer's own pricing.

Tiers here are **not synced** to Erply, WooCommerce or QuickBooks, and no email is sent when a tier is assigned.

---

## 16. Admin — Analytics

**URL:** `/admin/analytics`  
**File:** `app/admin/analytics/page.tsx`

A dashboard showing how the catalog is being used. Everything here is pulled from the `analytics_events` table in Supabase, which records product views and search terms automatically.

**What's tracked:**
- Every product detail page view (fires via `/api/track` on page load)
- Every search term typed (fires on debounced input)

**Dashboard sections:**
- **Date range filter** — 7 / 30 / 90 days / All time
- **Orders over time** — bar chart of orders submitted per day
- **Visitor funnel** — how many visitors reach each step from viewing to submitting
- **Why Submit didn't go through** — the reasons checkout was blocked
- **From printed line cards (QR)** — product views that came from scanning a line-card QR code
- Summary stats, most viewed products and top search terms

---

## 17. Admin — Price List

**URL:** `/admin/price-list`  
**File:** `app/admin/price-list/page.tsx`

A printable wholesale price list — all visible, priced products ($0 excluded), organized by category. You can filter by category, and **Prices at** prints the list at catalog price, at a tier, or for one customer (`lib/price-scope.ts`). Designed to be printed as a PDF handout for trade shows or sales calls. Prices are per unit; volume breaks aren't shown.

The **Photo Line Card** (`/admin/line-card`, and `/rep/line-card` for reps) is the photo-grid version, with the same **Prices at** option and QR codes that link to each product page.

---

## 18. Admin — Sync (Erply)

**URL:** `/admin/sync`  
**Files:** `app/admin/sync/page.tsx`, `app/admin/api/sync/route.ts`, `lib/erply.ts`, `lib/product-sync.ts`

L&Y USA uses **Erply** as their inventory management system, and it is the master for product names, prices, stock and active status. The sync is **live**: Erply has been configured in Vercel production since about 2026-09-23, so the nightly run uses real Erply data. The Status badge on this page says "Erply configured" (or "Not configured (stub mode)", which disables the run button).

**Nightly sync** (`/api/sync`, Vercel cron `0 8 * * *` = 08:00 UTC, about midnight–1 AM Pacific):

| Field | What the sync does |
|---|---|
| Name, price | Overwritten from Erply every run. Prices are rounded to the nearest quarter (never .75). A price approved on **Price review** is held and wins until Erply matches it. |
| Stock | Erply warehouse 1 only. Adds Erply's **change since the last run** rather than replacing the number, so manual adjustments and order deductions survive. A SKU Erply reports as 0 that has never had stock is left alone. |
| Active / inactive | Set from Erply. Active catalog products missing from the feed are deactivated, unless that would be more than 10% of active products (or 20 on a small catalog), in which case it deactivates nothing. |
| Category, description | Taken from Erply only when a product is first created. |
| Photos | Never touched. |
| Visibility | Never unhides. New $0 products and visible products whose price drops to $0 are hidden and marked "awaiting price". |

The same nightly run also sends the low-stock email, abandoned-cart reminders and resale-certificate reminders, and is recorded in the run history on this page.

**Running it by hand:** **Preview changes** shows a dry run (incoming, new, updated, deactivated, and a sample of SKUs that would be deactivated; the page warns not to run it if that number is unexpectedly large). **Run sync now** asks for confirmation, then reports new / updated / deactivated / skipped. The manual run does **not** sync stock; only the nightly run does.

**Webhooks:** `/api/webhooks/erply` can update stock on in-store sales (it needs `ERPLY_WEBHOOK_TOKEN`; it rejects requests when the token isn't set). `/api/webhooks/woo` handles WooCommerce webhooks. The Erply↔WooCommerce **customer** sync (`/api/sync/customers`) has been **off** since 2026-08-07 (`SYNC_CUSTOMERS_ENABLED`).

---

## 19. Admin — Audit Log

**URL:** `/admin/audit-log`  
**File:** `app/admin/audit-log/page.tsx`, `lib/audit.ts`

Every significant action in the admin leaves a record in the audit log. This includes:

- Stock adjustments (who changed what, by how much, and why)
- Order status changes (who moved an order from New → Contacted, etc.)
- QuickBooks "entered" toggles (who marked it, when)
- Product edits, visibility changes, price approvals, renames, credit-application decisions and the low-stock email switch

Each entry shows: action type, what was changed, old value → new value, who did it, and when.

---

## 20. Admin — Zero Results Report

**URL:** `/admin/zero-results`  
**File:** `app/admin/zero-results/page.tsx`

Shows every search term that was typed into the catalog but returned **zero products**. This is useful for spotting:

- Products customers want that aren't in the catalog yet
- Misspelled category or product names
- SKUs customers are searching for that have been deactivated

Search events come from the header search dropdown, as the customer types. The **#hidden** section lists **hidden** products that customers searched for by SKU or barcode — usually worth showing.

---

## 21. Email Notifications

**Files:** `lib/email.ts`, `lib/order-emails.ts`  
**Email provider:** Titan Mail SMTP (via nodemailer, included with L&Y's domain)

The site sends several types of automated emails:

| Trigger | Recipients | Content |
|---|---|---|
| New order submitted | Sales inbox, `SALES_ALERT_TO` (`sales@ly-usa.com`) | Full order details, backorders flagged; Reply-To is the customer |
| New order submitted | Customer (+ reps in Placed by / CC) | "We received your order request" with the reference code and tracking link |
| Status set to Contacted / Converted / Lost | Customer | "Update on your order" / "Your order is confirmed" / "Regarding your order request". **Close, no email** and Dismiss send nothing. |
| Customer message on the order page | Sales inbox | "Customer message — ORD-…"; Reply-To is the customer |
| Net-terms application submitted | Sales inbox | Link to the application in admin |
| Net-terms approved / declined | Applicant | The decision, terms and optional note (if "Email …" is ticked) |
| Resale certificate expiring / expired | Customer | Reminder before expiry, notice after (sent from the nightly run) |
| Low stock | `REORDER_ALERT_TO` (`sale@ly-usa.com`; switched off since 2026-11-11) | Which products have dropped to/below their threshold |
| Back in stock | Subscribers | "Back in stock: <name>" with a link to the product on lyusa.app |
| Abandoned cart | Customer | "You left something behind" (24 hours after, from the nightly run) |
| Waiting on you (Mondays) | `WAITING_DIGEST_TO` | Dormant: not set, by decision |

Mail is sent from the authenticated Titan mailbox (`TITAN_SMTP_USER`) unless `SALES_ALERT_FROM` / `REORDER_ALERT_FROM` are set; Titan rejects a From address the mailbox doesn't own. To check an inbox receives the app's mail, run `node scripts/send-test-email.ts <address>`.

---

## 22. Inventory Alerts

**Files:** `lib/low-stock-alert.ts`

When a product's stock drops to or below its threshold, a low-stock alert email is sent to `REORDER_ALERT_TO` (`sale@ly-usa.com`) — one email listing every product that went low, not one per product.

**How it triggers:**
- On product syncs and imports (`lib/product-sync.ts`), including the nightly cron
- On manual stock adjustments in the admin (single and bulk)
- On Erply webhook stock updates

**De-duplication:** Each product only alerts once per "restock cycle." Once a product gets the low-stock alert, it won't alert again until it's been restocked above the threshold and then drops below again. This prevents email spam if the same product stays low for days.

**Thresholds:** The default threshold is 5 units. Each product can have its own custom threshold set in the admin products page.

**On/off switch:** The **Low-stock email** checkbox on Admin → Products & Stock turns the email off without a redeploy (`alert_settings` table, migration 0077; `lib/alert-settings.ts`). Each change is audit-logged. While it's off, products that go low are still marked as alerted, so switching it back on only emails products that go low after that, not a backlog. Low-stock badges in admin are unaffected. Switched **off** 2026-11-11.

---

## 23. Abandoned Cart Reminders

**File:** `lib/abandoned-cart.ts`, `app/api/cart-session/route.ts`

A cart is saved server-side as a "cart session" only when the customer types an email in the cart's checkout form and leaves that box with items in the cart. The nightly run (08:00 UTC) emails any session that has gone 24 hours or more without an order — once only. The email ("You left something behind — L & Y USA") lists the items without prices and links back to the site; Reply-To is the sales inbox.

---

## 24. Back-in-Stock Notifications

**File:** `lib/back-in-stock-notify.ts`, `app/api/back-in-stock/route.ts`

On any out-of-stock product detail page there is a **Notify me** box (alongside the **Backorder** button). The customer types their email and submits ("We'll email you when this is back in stock"). Their request is saved to the `back_in_stock_requests` table.

Requests are checked whenever a **product sync or Excel import** runs (`syncToSupabase`) — **not** on a manual stock adjustment in admin. A subscriber is emailed only when the product has stock above 0 and is active and visible; requests for hidden products wait until it's shown. Each subscriber is emailed once, and the request is marked as notified. The email links to the product on `https://lyusa.app`.

---

## 25. Infrastructure & Services

**Hosting — Vercel**  
The app is deployed on Vercel. Every push to the main branch triggers an automatic deployment. The underlying Vercel URL is `https://livecatalog.vercel.app`; the custom domain `lyusa.app` is pointed here and is the live production URL.

**Database — Supabase (PostgreSQL)**  
All data lives in Supabase: products, categories, orders, customers, analytics, audit log, cart sessions, back-in-stock requests, stock adjustments, shipments, QuickBooks sync queue. Row Level Security (RLS) is enabled — the public catalog reads through explicit public SELECT policies; admin reads and writes use a secret key kept server-side. Migrations are applied by hand in the Supabase SQL editor.

**Inventory — Erply**  
The master for names, prices, stock and active status (Section 18). Receiving applies container stock directly in Erply.

**Accounting — QuickBooks Desktop**  
Reached through the QuickBooks Web Connector on the office PC, which polls `/api/qbwc` (Section 12).

**Images — Cloudinary**  
Product images are hosted on Cloudinary. The `lib/image.ts` helper generates responsive image URLs (resize, crop, format conversion) on the fly using Cloudinary's URL API. Images are referenced in the database by their Cloudinary URL; the catalog never stores images itself.

**Authentication — Supabase Auth**  
Three roles:
- **Customer accounts** — email/password, handled by Supabase Auth directly (`lib/auth-client.ts`, `lib/auth-server.ts`)
- **Admin** — requires `role: admin` in the user's `app_metadata`; `/admin/*` is enforced in middleware
- **Rep** — `role: rep`; `/rep/*` is enforced in middleware

Middleware gates only `/admin/*` and `/rep/*`. Every `/api/*` route is public and does its own check; admin-only APIs live under `/admin/api/*`, and cron/webhook routes check a secret via `lib/request-auth.ts`.

**Daily Cron — Vercel Cron**  
Runs at 08:00 UTC (`vercel.json`): the Erply product sync, low-stock email, abandoned-cart reminders and resale-certificate reminders. A Monday cron for the "Waiting on you" digest exists but stays dormant.

**Excel Parsing — SheetJS**  
The `xlsx` npm package (SheetJS) is used for all Excel reading and writing: parsing the import file in the browser, generating per-order Excel exports, and generating bulk CSV exports.

**Pack Quantity Parsing — `lib/pack.ts`**  
Product names follow a standard format like `"Foam Hearts - 12/pk 5bx/cs cs.60"`. The `lib/pack.ts` utility parses this string to extract pack size, boxes per case, and case quantity — used to display the per-case price alongside the per-unit price on product pages.

**Catalog Access Gate**  
A dormant feature — the entire public catalog can be put behind an access code (like a password for the storefront). Built and ready; activate by setting the `CATALOG_ACCESS_CODE` environment variable on Vercel. It's one shared code for every visitor, not per-account approval.

---

## 26. Admin — Other Screens

One line each; the in-app guide (`/admin/guide`) has the clicks for the day-to-day ones.

**Customers and paperwork**
- **Net-Terms Applications** (`/admin/credit-applications`) — **Details** shows "What we already know" (site quotes, QuickBooks/Erply matches, earlier applications); **Approve** (Net 30/60) or **Decline**, with an optional note and email; **Reopen** puts it back to pending. A record only: it doesn't set a tier or QuickBooks terms.
- **Resale Certificates** (`/admin/resale-certificates`) — **Verify** / **Reject** uploaded certificates. Verified makes the buyer's tax estimate $0 for that state; no email goes to the customer.
- **Sales tax** (`/admin/sales-tax`) — one estimated rate per ship-to state; an unlisted or switched-off state isn't collected. Nothing is sent to QuickBooks, which charges the real tax.
- **Promotions** (`/admin/promotions`) — promo codes buyers enter in the cart; each line gets the better of the usual price and the code's price, never both. Dates are Pacific time.
- **Registered Users**, **Accounts**, **Rep Performance**.

**Receiving and new products** — `/admin/receiving`
1. Upload the supplier's "Original List" .xlsx (optionally with a container number). Nothing is written yet.
2. Review Shipped / Received / Erply stock; **Save counts for later**, or tick "This container has not already been received." and **Apply** — adds the stock **in Erply**, one-way (applying twice doubles it). Catalog stock follows on the next nightly sync.
3. SKUs not in the catalog appear under **New products**: fill name, category, price and pieces/pack (**Attach Commercial Invoice** suggests names), **Create in Erply**, then **Add created products to the catalog** — they arrive hidden, at $0, flagged needs-photo.

**Catalog quality**
- **Catalog health** (`/admin/catalog-health`) — nightly sync status, visible products missing a price or photo, low-stock email state, prices waiting for Erply; **Check photo files** finds photos that don't load or are thumbnail-sized. (`scripts/find-blurry-photos.ts` goes further and lists low-resolution photos.)
- **Catalog Cleanup** (`/admin/cleanup`) — tabs Needs photo (drag-and-drop photo upload, files named by SKU; tick "Also replace the existing photo" to overwrite), Name not to standard, No category, No description, Needs pricing (Unhide / pull prices from Erply), Case price?.
- **Photo shot list** — printable list of in-stock products needing a photo, holiday items and searched SKUs first.
- **Show these?** (`/admin/show-review`) — hidden products that have everything; **Show** or **Keep hidden** (undoable).
- **Price review** — **Approve** sets the website price now and holds it until Erply matches; **Download Erply list** for prices to type into Erply.
- **Name review**, **Case-count review**, **Owner questions** — proposed renames and case-count fixes; approving writes to Erply, WooCommerce and the catalog together (needs the Erply login, so only from a local run).
- **Carton Measurements**, **Bin Capacity**, **Collections**, **Display Settings**, **Import History**, **WooCommerce export** (`/admin/woo-export`).
