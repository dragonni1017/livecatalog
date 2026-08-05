---
name: project-woocommerce-tier-mapping
description: ON HOLD for actual Woo changes -- skeleton script scripts/assign-woo-tier-roles.mjs added 2026-08-03; guessed CRM hostname was wrong (ENOTFOUND everywhere), fixed via getServiceEndpoints in scripts/check-erply-tier-groups.mjs
type: project
---

**Status: still nothing created/renamed/reconfigured in WooCommerce itself.**
Dragon asked for a skeleton of the customer-assignment bridge script
(2026-08-03) — `scripts/assign-woo-tier-roles.mjs` now exists, but it is a
scaffold, not a working script: it exits immediately with an error before
making any network call, because `fetchErplyCustomerGroupMembership()` is
an unimplemented stub (no Erply CRM/classic API call has ever actually been
made to read a *customer's own* group — only group create/edit/bulk-assign
calls have been made, see [[project-erply-customer-tiers]]). Two candidate
approaches are documented in the script's header, neither verified live.

The script also hard-codes the proposed tier->role mapping
(`TIER_TO_WOO_ROLE`) with `Retail`, `Exclusive`, and `Base` deliberately set
to `null` (no Wholesale Suite role exists for them yet, and `Base` is still
an open question of role-vs-no-role) — the script always skips those
customers to a `unmapped-tier.csv` rather than guessing. Even once the
membership-read TODO is filled in, the script defaults to a dry run
(`--apply` required to write, and even `--apply` isn't wired to a write
path yet in this skeleton).

Dragon asked whether the 5 Erply customer tiers
([[project-erply-customer-tiers]]: Base, Wholesale, Retail,
Distribution-Chain, Exclusive) could have an equivalent set up on the
WooCommerce side (ly-usa.com). Investigation found the site already runs
the **Wholesale Suite** plugin (discovered via the `wholesale/v1` REST
namespace at `wp-json/` root, auth reused from existing
`WOO_CONSUMER_KEY`/`WOO_CONSUMER_SECRET` Basic Auth — see
[[project-erply-woo-compare-script]] for where those env vars came from).

**Existing Wholesale Suite state (all read via GET, confirmed live
2026-08-03):**
- `GET /wp-json/wholesale/v1/roles` → 3 roles exist, all `count: 0`
  (no customers assigned to any yet):
  - "Chain" — term_id 45, slug `chain`
  - "Distributor" — term_id 46, slug `distributor`
  - "Wholesale" — term_id 18, slug `default_wholesaler`
- `GET /wp-json/wholesale/v1/category-discount` → `[]` (no category-level
  discount rules configured)
- `GET /wp-json/wholesale/v1/general-discount` → HTTP 200, body `""` (empty
  string) — re-confirmed live 2026-08-03, no general/store-wide discount is
  configured either. So: plugin installed, 3 roles exist, zero customers
  assigned to any role, zero discount rules of either kind set up.

**The mapping is not 1:1** — Wholesale Suite's 3 existing roles don't
cleanly match the 5 Erply tiers. Open questions for whenever Dragon
resumes this:
- Reuse "Chain" for Distribution-Chain, "Wholesale" for the Wholesale tier?
- Still need new roles for Retail, Exclusive, and possibly Base (or is
  Base just "no role / logged-out pricing"?)
- Whether to mirror Erply's markup percentages via Wholesale Suite's
  general-discount / category-discount rules, or some other mechanism
- How Erply's 3,461 customers (currently all in one Erply group, see
  [[project-erply-customer-tiers]]) get assigned to whichever Woo roles
  are created — no criteria given yet, same open question on both sides

**Separately still unresolved:** the original ask to import Erply's
customer list into WooCommerce was never finished. Dragon confirmed
"skipping customers with no email is fine on top of removing dup emails,"
but the actual import script/run was never built — an earlier
AskUserQuestion call about full scope (~3,093 usable-email customers vs
~3,102 companies-only) failed silently and was never re-asked before
Dragon moved on to the tiers topic.

**IMPORTANT, confirmed via Erply's own docs 2026-08-03 — the official
Erply "WooCommerce Integration" app CANNOT carry the 5-tier price
structure over automatically.** Per Erply's WooCommerce Integration 2.0
setup guide (Step 4: Payment & Pricing) and the WooCommerce FAQ, the
integration only supports **one** "Price List for Regular Prices" and
**one** "Price List for Sale Prices" — singular, store-wide, applied to
every WooCommerce product/customer the same way. There is no field or
setting that syncs multiple Erply customer-group price lists into
WooCommerce as customer-specific/tiered prices. (The "associate up to 5
price lists to a customer group" feature that shows up in Erply's own
Price Lists doc is an Erply-internal customer-group feature — it does not
flow through the WooCommerce Integration app at all.)

**Practical implication for the external dev:** there is no
import/connect button that carries Base/Wholesale/Retail/
Distribution-Chain/Exclusive pricing into WooCommerce. Only path to real
tiered pricing on the Woo side is the already-installed **Wholesale
Suite** plugin, configured independently of the Erply sync.

**Difficulty assessment, 2026-08-03 (research only, nothing built):**
turns out this splits into two pieces of very different size:
1. **Pricing markup — no live bridge needed at all.** Wholesale Suite
   Premium (WWPP) supports fixed markup OR discount, in percentage or
   flat amount, per role (confirmed via wholesalesuiteplugin.com's own
   docs — "options to markup or discount prices for all or specific
   customers and user roles"). Since all 5 Erply tiers are fixed
   percentages off one base (not something that needs to stay
   dynamically synced), the dev can just type the 5 percentages once
   into WooCommerce → Settings → Wholesale Prices → Roles and be done —
   config, not code. Caveat: confirm the site is actually licensed for
   WWPP (premium), not just the free Wholesale Prices plugin — the
   general-discount/category-discount REST routes existing at all is a
   good sign it's premium, but worth a direct confirm.
2. **Customer → tier assignment — this is the one real "bridge" piece.**
   Wholesale Suite's own REST API (`wholesale/v1`) only covers products,
   variations, roles config, and leads — no customer/role-assignment
   endpoint. Role assignment is a standard WordPress user role, settable
   via the normal `wp/v2/users/{id}` or `wc/v3/customers/{id}` REST
   calls. So the actual custom-code part is: read each customer's Erply
   group (CRM API, already used this session for
   [[project-erply-customer-tiers]]) and set the matching WP role on
   their Woo account via standard REST calls — a straightforward batch
   script, roughly a day of work including testing for 3,461 customers,
   re-runnable if Erply group membership changes later.

**Bottom line: this is small, not a big build** — a few days for
someone comfortable with REST APIs, not weeks. Worth telling the
external dev both halves up front so they don't assume they need to
write a live pricing sync (they don't) or assume Wholesale Suite exposes
a customer-assignment API (it doesn't — that part's on the WP/WC side).

**UPDATE 2026-08-04 — two of the three open items resolved:**
1. **Default tier for any new customer (Erply POS or Woo signup) is now a
   fixed policy: Wholesale, until manually reassigned.** No "unassigned"
   state to handle. See [[project-tier-auto-suggestion-blocked]] for the
   superseded suggestion-engine plan this replaces.
2. **Base is intentionally near-empty** — no customers should ever be
   assigned it, so the Woo side only needs real roles for **Wholesale**
   (exists: `default_wholesaler`), **Distribution-Chain** (map to existing
   "Chain" role), **Retail**, and **Exclusive** — the latter two still need
   new Wholesale Suite roles created; Base needs no role at all.
3. **The stalled Erply->Woo customer import is no longer this project's
   problem** — Dragon says a third-party team is importing customers
   directly from `erply-customer.xlsx` into WooCommerce right now, and the
   two customer lists "should be exactly the same" as of 2026-08-04. Not
   independently verified via API — worth a live customer-count check
   before building the live sync bridge on top of it. Open question raised
   but not yet answered by Dragon: does that third-party import set any
   WP role/tier on the accounts it creates, or just core fields (name/
   email/address)? If it's the latter, the bridge's first job is a
   one-time Wholesale-role backfill over whatever they just imported,
   *then* the live webhook path takes over for anything new.

**RESOLVED 2026-08-04:** Dragon confirmed the third-party import *does* set
WP roles, matching each customer's Erply tier 1:1. So no backfill step
needed — go straight to the live webhook path once the import finishes.
**Live risk this surfaces:** only 2 of the 4 needed roles (Wholesale,
Chain) exist in WooCommerce today (see "Existing Wholesale Suite state"
above, confirmed live 2026-08-03) — Retail and Exclusive roles do not
exist yet. If their import is running *right now* and tries to assign a
customer to a `retail` or `exclusive` role slug that doesn't exist in
Wholesale Suite, that assignment will either fail, silently no-op, or fall
back to no role — not confirmed which. **This needs to be checked/fixed
before or during their import, not after** — either get the two missing
roles created in WooCommerce first, or confirm with the third-party team
how they're handling tiers with no matching role yet.

**Why:** Dragon wants WooCommerce pricing/customer segmentation to
eventually mirror the Erply tier structure, but is still in a
verify-before-touching-prod mindset for the Woo side specifically
(unlike the Erply side, which was already built live).

**How to apply:** do not create/rename Wholesale Suite roles, set
discount percentages, or assign customers until Dragon gives explicit
go-ahead — the last instruction in-session was explicitly read-only for the
Woo side. The skeleton script is safe to iterate on (no network calls run
today), but before making it actually functional: (1) confirm which of the
two membership-read approaches in the script header actually works against
live Erply data, (2) get the Retail/Exclusive/Base role question resolved
first — don't default them to an existing role to unblock the script.

**CORRECTED 2026-08-03 (later same day):** re-verifying the Woo side (still
unchanged — 3 roles, both discount endpoints empty, matches the original
snapshot exactly) surfaced a real bug in the Erply CRM half: the CRM API
hostname assumed everywhere in this doc and in `scripts/assign-woo-tier-roles.mjs`
(`{clientCode}.api-crm-us.erply.com`) does not resolve — confirmed `ENOTFOUND`
from both this project's sandbox and Dragon's own Windows machine, so it's
not a network/firewall issue, the hostname itself looks wrong. Erply's docs
confirm the CRM URL is account/data-center-specific and must be looked up
live via the classic API's `getServiceEndpoints` call, not assumed from a
naming pattern. `scripts/check-erply-tier-groups.mjs` now does that lookup
correctly (dumps the full `getServiceEndpoints` response and picks out the
CRM-like key rather than hardcoding one) — run that first, locally, before
trusting anything else CRM-related in this project, including whether the
original [[project-erply-customer-tiers]] group/price-list writes actually
landed where we think they did.
