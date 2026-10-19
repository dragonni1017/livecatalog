---
name: project-lyusa-batches-20261019
description: 2026-10-19: LYUSA item-import batches are npm run lyusa:batch / lyusa:mark-sent; what's been sent lives in lyusa_submissions (0065), files in data/lyusa/batches/; replaced export-lyusa-format.mjs
type: project
---

LYUSA item imports (84-column ALL21 layout + `<SKU>.jpg` photo zips) are built
by `scripts/lyusa-batch.ts` into `data/lyusa/batches/<name>/` and recorded as
sent by `scripts/lyusa-mark-sent.ts` into `lyusa_submissions` (migration 0065).
Row logic is `lib/lyusa.ts`, moved verbatim from the deleted
`scripts/export-lyusa-format.mjs` (output checked byte-identical, 1,185 rows).

- Historical batches were back-filled from files in Downloads: ALL21 (258
  SKUs) and NEW9 (161) dated 2026-10-15 from file mtimes, not a known send
  date; 2026-10-19 (1,042) is the first batch from the new flow's filter.
- Zips are written with SheetJS's bundled `XLSX.CFB` (no zip dependency, no
  zip CLI on this machine). It can't set entry dates, so files show
  1/1/1980 when extracted; harmless.
- Photos are resized with `sharp`, which comes in through `next`, not
  `package.json`.

**Why:** "what has LYUSA already got" used to be answered by diffing old CSVs
in Downloads.

**How to apply:** For a new batch run `lyusa:batch`, send, then `lyusa:mark-sent`.
Don't hand-filter CSVs; if a batch was built but not sent, delete its folder.
