---
name: project-erply-customer-tiers
description: 5 Erply customer groups + price lists built 2026-08-03, RE-VERIFIED live 2026-08-03 -- structure correct, all 3,461 customers still in Wholesale (id 19), 0 in the other 4 tiers, segmentation not started
type: project
---

**Erply-side tier structure created 2026-08-03**, via Erply CRM API (not the
classic API — classic `sessionKey` reused as a header against the CRM REST
endpoints `POST /v1/customers/groups`, `PATCH /v1/customers/groups/{id}`,
`POST /v1/customers/groups/{id}/customers`, max 100 customers per bulk-assign
call). No script was written for this — it was done via direct API calls in
the session, so there's nothing in `scripts/` to re-run; if this needs
repeating (new tier, price adjustment), redo it against the CRM API directly
or write a script first.

**CORRECTED 2026-08-03 (later same day):** the CRM API hostname used at the
time (`{clientCode}.api-crm-us.erply.com`) was a guess and is WRONG —
confirmed `ENOTFOUND` from two different machines when re-verifying. Correct
pattern, confirmed working live: call classic API `getServiceEndpoints`
(clientCode only, no session needed), read the `crm` entry's `.url` field —
`https://api-crm-us.erply.com/`, a shared regional endpoint with **no
client-code subdomain**, unlike the classic API — then call
`GET {that url}/v1/customers/groups` with **both** `clientCode` and
`sessionKey` as headers (CRM API needs clientCode as a header since the URL
itself doesn't carry it). See `scripts/check-erply-tier-groups.mjs` for the
working implementation.

**RE-VERIFIED LIVE 2026-08-03 via the corrected endpoint — group structure is
confirmed correct**, resolving the retroactive-confirmation worry above: all
5 tier groups exist with the right names and `priceListId` links (plus 3
unrelated Erply default groups — Default group/Company/Individual, ids
14/17/18):
- Base — id 20, priceListId 0 (unchanged base price, as designed)
- Wholesale — id 19, priceListId 7
- Retail — id 21, priceListId 8
- Distribution-Chain — id 22, priceListId 9
- Exclusive — id 23, priceListId 10

**Per-group customer counts — RE-CONFIRMED live 2026-08-03** via
`scripts/check-erply-tier-membership.mjs` (classic API `getCustomers` with
its `groupID` filter param, one call per group, reading `status.recordsTotal`
— classic API resolves fine from anywhere, unlike the CRM API). Result
exactly matches the original snapshot: **all 3,461 customers still in
Wholesale (id 19); 0 in Base/Retail/Distribution-Chain/Exclusive; 0 in the 3
unrelated Erply default groups.** Sums reconcile exactly against the
account-wide total (3,461 = 3,461) — nothing hiding in an unlisted group.
Segmentation genuinely has not started yet; this isn't a stale/unverified
claim anymore.

**Pricing formula (Dragon's spec, today's Erply price = "base"):**
- Base = today's price, unchanged
- Wholesale = base + 20%
- Retail = wholesale + 100%
- Distribution/Chain = base + 10%
- Exclusive = wholesale + 25%

Implemented as Erply price lists linked to each customer group via the CRM
API's `priceListId` field on `PATCH /v1/customers/groups/{id}`. Erply price
lists only support fixed prices or percentage-discount rules **per product
group**, not an arbitrary "all products" rule — confirmed empirically that a
*negative* `discountPercent` on a price-list rule produces a *markup* (a
-20% discount on a $2.00 base product came out to $2.40, i.e. +20%), which
is how each tier's markup was actually encoded.

**Current state, as of 2026-08-03: all 3,461 Erply customers are in a
single "Wholesale" group (group id 19).** Dragon asked to bulk-set everyone
there "for now" before the 5-tier structure existed — this was step 1, not
the final segmentation. **No criteria has been given yet for how to split
customers across the 5 tiers** (Base/Wholesale/Retail/Distribution-Chain/
Exclusive) — that's an open decision, not an oversight.

**Why:** Dragon wants tiered wholesale pricing live in Erply as the source
of truth, with WooCommerce eventually mirroring it — see
[[project-woocommerce-tier-mapping]] for the Woo-side half of this, which is
NOT done (read-only investigation only, explicitly on hold).

**How to apply:** before doing anything else with these price lists (editing
percentages, adding a 6th tier, etc.), reconfirm current group/price-list
IDs live via `getCustomerGroups` / a CRM API list call rather than trusting
this note's IDs blindly — this was a fast-moving live edit, not something
tested for drift-resistance. Next real decision: what makes a customer
Retail vs Wholesale vs Exclusive etc. (order volume? manually tagged?
imported from somewhere?) — nothing to derive this from yet.
