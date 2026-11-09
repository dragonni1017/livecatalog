---
name: project-admin-guide-waiting-trend-20261109
description: 2026-11-09: admin guide page (#243); Waiting page "since last week" (0074 waiting_snapshots, #245, baseline seeded Nov 9); description batches 46-47 switched to hidden products missing only a description (1,019 left; 116 Show-ready); 14 owner questions incl. new "OK to show?" kind (#246); minimatch override (#244); data/ excluded from local lint/tsc (#247); no admin activity since Nov 4
type: project
---

**State on 2026-11-09: nobody has used the admin since 2026-11-04.** Every
audit_log row since then is a Claude description batch. All queues are built;
the bottleneck is people, so further builds were paused on that basis. Check
the Waiting page trend before proposing new admin features.

- **`/admin/guide` (#243):** one printable "How to use the admin" page, by
  role (Owner, Price setter, Sales, Office, Warehouse & photos), linked from
  the dashboard under Waiting on people. Static; button names were checked
  against the real components, so update it when a screen's buttons change.
- **Waiting page "since last week" (#245, migration 0074):**
  `waiting_snapshots(day, queue, count)`, one row per queue per LA day,
  written on each page load (today's row overwritten) and by the Monday
  `/api/cron/waiting-digest` cron, which still sends no email (see
  [[no-email-digest]] in the user's auto-memory: they don't want email).
  `lib/waiting-trend.ts` compares with the newest day at least 7 days old,
  else names the oldest day ("since Nov 9"). Empty queues aren't saved, so a
  missing row counts as 0. **Baseline seeded 2026-11-09 from a local script**
  (quotes 25, QuickBooks 25, credit 9, certificates 5, renames 120, prices
  82, Erply prices 192, case counts 72, owner questions 56, hidden searched
  105, photos 796).
- **Hidden-demand list counts SKUs typed with spaces** ("f 288022", #242):
  letters-then-digits terms retry with spaces removed.
- **Description batches 46-47** (local `data/description-batch-4{6,7}-*`,
  audit rows + undo files): the "hidden, searched, has photo, no
  description" pool is used up (3 left). Batches now take **hidden products
  missing only a description** (photo, price, category present), most stock
  first: 1,019 left after batch 47. Each one described joins "Show these?",
  which had **116** after batch 47. Continues
  [[project-descriptions-no-source-20261026]]. Most of this pool reads stock
  1000, which is the known fake value: see [[project-fake-stock-1000-hold]]
  and don't raise it.
- **Owner questions batch `2026-11-09` (14):** 5 wrong/swapped photos
  (F287491, B325084-1, B325085, B325111/112; the last two also carry another
  company's branding), 6 "OK to show?" (designer/cartoon look-alikes: XX322,
  XX323, B325086, B325099, C266015, C266016), 3 name typos. "OK to show?" was
  added to `OWNER_KINDS` (#246); a kind not in that list still shows under
  "All kinds" but not in the filter. 3D801156's photo is 80x60 and needs a
  reshoot (not an owner question).
- **minimatch override (#244):** `overrides` pins `minimatch ^11.0.1` under
  `@typescript-eslint/typescript-estree` for GHSA-g3hv-75wg-m249 (lint
  tooling only; production deps audited clean). Remove the override once
  typescript-estree itself asks for ^11. `npm audit fix --force` would have
  downgraded eslint-config-next to 15.
- **`data/` is excluded from eslint and tsconfig (#247),** so local
  `npm run lint` and `npm run build` pass like CI. Scripts in `data/` run
  via tsx, which doesn't need the tsconfig include.
- **Gotcha: SheetJS ESM `XLSX.writeFile` throws "cannot save file"** unless
  `XLSX.set_fs(fs)` is called first (`import * as XLSX from 'xlsx'` in a
  .mjs). Reading with `XLSX.read(buffer)` doesn't need it.

**Why:** a week of building with no admin use; the guide and the trend are
there to get the queues moving and to show whether they do.
**How to apply:** start the next session by comparing the Waiting page (or
`waiting_snapshots`) with the Nov 9 baseline above. If nothing moved, the
people side needs attention before more features.
