---
name: feedback-invoice-not-price-source
description: The Commercial Invoice for a PO arrives after receiving and is only for item addition/adjustment — don't propose it as the source of intended sale prices
type: feedback
---

Don't suggest backfilling `shipment_lines.proposed_price_cents` (or any
"intended price") from the Commercial Invoice.

**Why:** Dragon, 2026-09-24: invoices for a PO are sent afterward, for item
addition/adjustment only. They aren't part of pricing. The first
`scripts/reconcile-prices.ts` run came back with all 88 products NO INTENT, and
using the invoice to fill that gap was proposed and turned down.

**How to apply:** the intended price comes only from what's typed into the
new-products panel during receiving. Products created before 2026-09-24 stay NO
INTENT; price them from the pricing worklist, not by reconciling. Treat the
invoice as a list of items and quantities, not as a place to get prices.
Related: [[project-receiving-to-catalog-20260923]].
