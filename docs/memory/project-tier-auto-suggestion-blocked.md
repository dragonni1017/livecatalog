---
name: project-tier-auto-suggestion-blocked
description: auto-suggesting price tiers for new customers is ON HOLD -- Erply/Woo/livecatalog all have ~zero real purchase history to score against, confirmed live 2026-08-03
type: project
---

**Dragon's plan (2026-08-03):** manually clean up all 3,461 existing
customers' tier assignments (see [[project-erply-customer-tiers]]) by hand,
but for *new* customers going forward, run a script that looks at purchase
size/amount/frequency and suggests 1-3 candidate tiers (Distribution-Chain /
Wholesale / Retail) for a human to pick from -- not full auto-assignment.

**Built and calibration-tested live, but blocked on data:**
`scripts/calibrate-tier-thresholds.mjs` was written to pull a trailing
window of confirmed Erply sales documents (`getSalesDocuments`, types
INVOICE/CASHINVOICE/INVWAYBILL, confirmed=1) and derive percentile-based $
thresholds from the account's own real distribution, rather than guessing
numbers. Running it live surfaced the actual blocker:

- **Erply: 0 sales documents, account-wide, all time, every document type**
  (confirmed by querying `getSalesDocuments` with zero filters at all --
  `status: ok`, `recordsTotal: 0`, so this is real, not a permissions
  error). Checked INVOICE, CASHINVOICE, INVWAYBILL, ORDER, WAYBILL, OFFER
  individually, same result on each.
- **WooCommerce (ly-usa.com): 1 order total** (`wc/v3/orders?per_page=1` →
  `X-WP-Total: 1`).
- **livecatalog's own `order_requests` table: 4 rows, all `status = 'new'`,
  none `converted`, $390.04 combined.** The site itself hasn't generated
  real order volume yet either.

So none of the three systems this project can reach via API has enough (or
any) real transaction history to compute "purchase size, amount,
frequency" from. Actual sales apparently live in QuickBooks Desktop, which
per root CLAUDE.md is where admin manually keys approved orders — a local
desktop app, not reachable from a script.

**Decision: hold off entirely.** Dragon chose not to build against thin
data and not to pursue a QuickBooks export/API path right now. Tier
assignment stays fully manual (both the 3,461-customer cleanup and any new
customers) until a real data source exists.

**What's already built and safe to resume from, when this comes back:**
`scripts/calibrate-tier-thresholds.mjs` (percentile calibration, tested
live, correct logic — just nothing to calibrate against yet) exists in
`scripts/`. The planned next piece,
`scripts/suggest-customer-tiers.mjs` (score new customers against the
calibrated bands, output top 1-3 suggestions to CSV, internal-use only —
no admin UI), was **not** built — stopped before writing it once the data
gap surfaced.

**Also still open, unresolved by this session:** whether "Base" and
"Exclusive" tiers can ever be volume-derived at all. Erply's markup
structure (Base=+0%, Distribution-Chain=+10%, Wholesale=+20%,
Exclusive=+50% over base, Retail=+140% over base — see
[[project-erply-customer-tiers]] for the raw formula) isn't a single
monotonic scale: Exclusive sits *above* Wholesale in price despite the name
suggesting a premium/curated relationship rather than raw volume, and Base
being "today's unchanged price" suggests a legacy/negotiated status more
than a volume bracket. The suggestion engine, whenever built, should
probably only ever rank customers among Distribution-Chain / Wholesale /
Retail and leave Base / Exclusive as manual-only tags — not confirmed with
Dragon yet, just flagged here so it isn't silently assumed later.

**SUPERSEDED 2026-08-04:** Dragon decided new customers (both Erply POS and
WooCommerce signups) always default to **Wholesale** until manually
reassigned — a fixed policy, not a placeholder. This replaces the
"score and suggest 1-3 candidates" plan above; no suggestion engine is
needed right now. `scripts/calibrate-tier-thresholds.mjs` is still fine to
resume later if Dragon wants smarter-than-Wholesale defaults once real
purchase history exists, but it's not blocking anything currently. Also
confirmed same day: **Base is intentionally meant to have ~zero customers**
— it's an internal/legacy price point, not a tier customers get assigned
into, manually or automatically. See [[project-erply-customer-tiers]] and
[[project-woocommerce-tier-mapping]] for how this simplifies the
Erply<->Woo customer bridge (only Wholesale/Retail/Distribution-Chain/
Exclusive need real logic; Base needs none).

**Why:** Dragon wants tiering to eventually be low-touch for new customers,
but refused to build a scoring engine against fabricated or empty data —
consistent with this project's general pattern of verifying before
building (see [[project-erply-customer-tiers]],
[[project-woocommerce-tier-mapping]] for the same instinct applied to the
Erply CRM hostname and the WooCommerce integration limits).

**How to apply:** before resuming this work, re-check whether any of the
three purchase-history counts above have grown (a fresh
`getSalesDocuments` no-filter call, a Woo orders count, or
`select count(*) from order_requests where status = 'converted'`) — don't
assume this snapshot is still accurate after time has passed. If QuickBooks
data ever becomes reachable (export, or a QBO migration), that's the
strongest candidate data source and wasn't investigated further this
session.
