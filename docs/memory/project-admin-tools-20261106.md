---
name: project-admin-tools-20261106
description: 2026-11-05/06 admin tools: close old quotes without emailing (notify:false on the approval route, #225), credit applicant history (no payment data exists here, #226), WooCommerce import CSV export (#227), WooCommerce description push script, dry run only (#224)
type: project
---

**Quiet close for old quotes (#225).** The status buttons email the
customer on contacted/converted/lost, and dismiss only allows
test/duplicate/spam (a DB constraint). For months-old quotes handled outside
the site, `PATCH /admin/api/orders { status, notify: false }` skips ONLY
`notifyOrderStatusChange`; converted still queues QuickBooks and decrements
stock, and the audit says "(no customer email)". Needs follow-up shows a
"same customer sent ORD-... later" hint (lib/order-cleanup.ts). On
2026-11-05 none of the 24 waiting quotes was in QuickBooks or had a response.

**Credit applicant history (#226).** lib/credit-history.ts matches each
pending application to site quotes, the QuickBooks customer list (email,
then company name with suffixes dropped), Erply links and earlier
applications. **There is no invoice / A/R / payment data anywhere in this
system**; the screen says to check QuickBooks, never infers payment
behaviour.

**WooCommerce export (#227, /admin/woo-export).** "Ready" = active, shown,
photo, price, category, real description: 1,163 on 2026-11-06. CSV uses
WooCommerce's own import column names (import with "Update existing
products", matched by SKU). Name, price and stock are left out on purpose
(Erply's integration owns them). Categories and Images are opt-in: 13 of 35
category names had no exact WooCommerce match (the importer would create
them), and re-importing images duplicates them in the media library.
Route files may only export handlers, so the loader is lib/woo-export-load.ts.

**WooCommerce description push (#224, scripts/push-catalog-descriptions-to-woo.ts).**
Dry run by default; NOT applied. Waiting on: whether Erply's WooCommerce
Integration syncs "description" (Field mapping; it would overwrite), and the
WooCommerce team's OK. 180 empty on Woo (scope=empty), 963 with other text
(scope=replace, needs their OK). See [[project-woo-vs-catalog-20261104]].

**Why:** each of these changes or bypasses a default (emails, payment
assumptions, which Woo fields to send) for a reason that isn't in the code.
**How to apply:** don't "fix" notify:false or the missing name/price/stock
columns back; check the two Woo preconditions before any --apply.
