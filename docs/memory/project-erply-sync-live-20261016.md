---
name: project-erply-sync-live-20261016
description: 2026-10-16 CONFIRMED the nightly Erply → catalog sync is LIVE (roadmap "blocked" entry was stale); Hobby keeps logs 1h so runs are now recorded in sync_runs (0061) and shown on /admin/sync; 146 active products aren't in Erply (144 hidden orphans + 2 visible)
type: project
---

**The Erply auto-sync is on and working.** The roadmap listed it as "blocked,
waiting on Erply data", which was stale and has been removed.

- `vercel.json` cron → `GET /api/sync` daily at **08:00 UTC (1 AM PT)**. Hobby
  allows only daily crons; the old "every 30 minutes" comment was wrong and
  is fixed. ERPLY_* are set in production (since about 2026-09-23).
- Evidence from 2026-10-16: **3,215 of 3,364 products** were updated in the
  08:00 UTC hour, and **65 stock adjustments** were made. No stale cluster
  remained (a failed 500-row chunk would leave one). The run log itself was
  already gone.
- **Vercel Hobby keeps runtime logs for one hour**, so a 1 AM run's output
  is unreadable by morning. Migration **0061 `sync_runs`** (server-only:
  RLS on, no policies) now gets one row per run from both the cron and the
  admin "Sync Now" button (`lib/sync-runs.ts`; `recordSyncRun` never throws).
  `/admin/sync` shows the last 30 runs with errors, plus a health banner. It
  warns when the latest nightly run wasn't `ok`, or when there's no clean
  nightly run in 26h. History starts with the first run after deploy.
- What the sync writes: names and prices from Erply, plus stock (separately).
  It **never** overwrites image_url, stock_qty (via upsert), category or
  description; see the route comments.
- **146 active products aren't touched by it** (not in Erply):
  - 144 are `manually_hidden`: the August orphans
    ([[project-orphan-sku-review-resolved]]).
  - **2 are visible and orderable: T641519 and T641730.** Both were
    hand-added on 2026-08-19, have placeholder stock 999, share a barcode
    with another SKU (T641521 / T641725) and exist in QuickBooks. Their price
    won't follow Erply until they're added there or hidden. That's a
    product-data owner's call, not the developer's
    ([[user-role-developer-not-ops]]).

**How to apply:** to check a night's sync, read `/admin/sync` or `sync_runs`,
not Vercel logs. If the table is empty after a night, the cron didn't run or
the deploy predates 0061.
