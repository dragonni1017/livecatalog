---
name: project-erply-duplicate-customer-incident
description: 2026-08-07 incident -- manually testing the customer sync route against production created 1,121 duplicate Erply customers; root cause fixed, duplicates deleted, cron stays disabled
type: project
---

**What happened:** while verifying the newly-built `/api/sync/customers`
route worked end-to-end, it was invoked twice against real production data
(via a local dev server, `CRON_SECRET` used deliberately). Both invocations
took ~5.1 minutes and returned HTTP 200. The Woo->Erply direction created
**1,121 duplicate Erply customers** (customerID range 13041-14161, all
groupID 21/Retail) before this was noticed via a routine "did the customer
count change" sanity check.

**Root cause:** both directions of the sync only checked
`erply_woo_customer_links` (a table that had only 2 rows at the time —
[[project-erply-woo-customer-sync]] never populated it for the ~3,180
customers that already matched on both sides from the third-party import)
before deciding whether to create a new customer. Neither direction ever
checked whether a customer with that email already existed on the *target*
side. WooCommerce enforces email uniqueness at the platform level, so the
Erply->Woo direction's equivalent bug just produced silent-ish errors
(`registration-error-email-exists`, logged not duplicated). Erply's
`saveCustomer` does **not** enforce email uniqueness (confirmed: its
response even has an `alreadyExists` field, implying duplicates are an
expected possibility the caller is meant to check for) — so the Woo->Erply
direction sailed through and created a duplicate for nearly every one of the
~3,180 already-matched customers it touched.

**How it was caught:** re-checking Erply's live customer count between two
sync-route test invocations showed it climbing (4522 -> 4537 -> 4587) even
*after* the local dev server process tree was killed — the growth was from
the two already-dispatched request executions finishing their sequential
create loops, not a new source. Two 15-second-apart readings confirmed
growth had actually stopped once fully killed.

**Fix, applied same day:**
1. `app/api/sync/customers/route.ts` — removed from `vercel.json` crons,
   and gated behind a `SYNC_CUSTOMERS_ENABLED=true` env var that is NOT set
   anywhere, so neither the Vercel cron nor a manual authorized curl can
   trigger it. Do not set that var until deliberately re-enabling.
2. Both directions now cross-check the OTHER side's full customer list by
   email (already fetched in-memory for the diff, no extra API calls) before
   creating anything — an email match means "link, don't create." An
   in-request `recordLink()` helper keeps the two loops' view of
   already-linked customers consistent within a single run, so the same
   email can't be processed twice in one invocation either.
3. `scripts/backfill-erply-woo-customer-links.mjs` — Supabase-only (never
   calls Erply/Woo write APIs), matches both full customer lists by email,
   inserts link rows for confirmed matches. Cannot create a duplicate by
   construction. Run for real 2026-08-07: 2,764 link rows inserted, 0
   errors. `erply_woo_customer_links` now has 2,768 rows total, all with
   unique erply_customer_id and woo_customer_id (verified via SQL).
4. `scripts/cleanup-erply-duplicate-customers.mjs` — for each customerID
   >= 13041, confirmed it had a matching original (customerID < 13041, same
   email) before deleting — 1,121/1,121 confirmed, 0 unconfirmed/ambiguous.
   Deleted the 1,121 duplicates plus 1,000 stale `erply_woo_customer_links`
   rows that pointed at them (created by the buggy runs, pointing to the
   wrong erply_customer_id). Backup CSV logged to
   `data/erply-duplicate-cleanup/` (gitignored, contains customer emails)
   before each delete. 0 errors. Erply customer count confirmed back to
   3,466 (exact expected baseline) after cleanup.

**Follow-up same day: added dry-run mode to the route itself**
(`GET /api/sync/customers` defaults to dry-run now; `?apply=true` required
for real writes, still gated by `SYNC_CUSTOMERS_ENABLED`). First dry run
against live data caught a SECOND bug: `db.from('erply_woo_customer_links').select('*')`
had no pagination, and Supabase silently caps unpaginated selects at 1,000
rows — with the link table now at 2,768 rows, the route only ever saw the
first 1,000 and treated the other 1,768 already-linked customers as
unlinked (`linkedExisting: 1768` in the dry run, should have been ~0). Not
dangerous on its own (the per-email unique constraint would have turned
each into a caught error, not a duplicate) but would have been a wall of
noise on a real run. Fixed by paginating the link-table read in 1,000-row
pages; re-ran dry-run and confirmed `linkedExisting: 0`, `wooCreated: 27`
(the known malformed-multi-email gap), 0 errors — matches the expected
steady state exactly. This is the dry-run mode paying for itself on its
first real use.

**Current state:** root cause fixed and verified via dry-run-then-apply
tooling; 1,121 duplicates removed with 0 dangling references; link table
populated for all 2,764 genuine pre-existing matches; pagination bug in the
link-table read also fixed and dry-run-verified. The sync route itself has
**not** been re-run live (`?apply=true`) since either fix —
`SYNC_CUSTOMERS_ENABLED` is still unset by design. Two throwaway test
customers from earlier in the session (`claude-backfill-test-*@example.invalid`,
Erply IDs 13037/13038)
are still present in Erply — Dragon said he'd handle those himself,
unrelated to this incident's duplicate range (13041+).

**Why:** moving straight from "code looks right" to "run it against
production to verify" skipped the step that would have caught this — a
dry-run mode or a tiny-scope test (one customer) before a full live
invocation. [[project-erply-woo-customer-sync]] and
[[project-woocommerce-customer-role-filter-bug]] are the two prior memories
this built on; neither flagged the missing existing-customer check because
neither actually exercised the Woo->Erply create path against real data
before this.

**How to apply:** before ever setting `SYNC_CUSTOMERS_ENABLED=true` again —
re-verify `erply_woo_customer_links` row count and spot-check a handful of
rows live (not from this memory) — the two-full-list-diff approach used for
the fix and the two cleanup/backfill scripts should not be assumed correct
indefinitely as data drifts on either side. Any future change to either
direction's create path must preserve the "check the target side by email
before creating" invariant — that is the actual fix, not just this
incident's symptom.

**Re-verified live 2026-08-18** (code unchanged since the fix, confirmed by
reading `app/api/sync/customers/route.ts` — both directions still check the
target side by email before creating): link table is exactly 2,768 rows,
100% unique across `erply_customer_id`/`woo_customer_id`/`email` (zero
drift or corruption since the cleanup). Ran a real dry-run against the
route itself (`GET /api/sync/customers`, no `?apply=true`, so genuinely
zero writes) against live Erply/Woo data: `wooCreated:28 wooRoleUpdated:1
erplyCreated:0 linkedExisting:0 skippedStaffAccount:9
skippedKnownNonSync:40 errors:0`. `erplyCreated:0` is the important number
— the direction that caused this incident would create zero new Erply
customers if enabled right now. `linkedExisting:0` confirms no accumulated
drift. Not yet re-enabled (`SYNC_CUSTOMERS_ENABLED` still unset) — that's a
separate decision requiring explicit go-ahead, this only re-confirms the
fix still holds up against current data.
