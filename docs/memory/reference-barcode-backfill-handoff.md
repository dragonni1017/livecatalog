---
name: reference-barcode-backfill-handoff
description: where the known barcode leading-zero backfill gap is tracked and what's blocking it
type: reference
---

11 known stripped-leading-zero barcode rows still need backfilling in the DB. Full
detail and the fix approach are in `docs/BARCODE-LEADING-ZERO-FIX-HANDOFF.md`.
`scripts/backfill-barcodes.mjs` is the existing script for this class of fix.

**Why:** blocked on the external source-spreadsheet folder being mounted — not
something to try to solve without that input.

**How to apply:** if asked about barcode data quality, point at the handoff doc
first rather than re-deriving the row list from the database. Don't attempt the
backfill without the source spreadsheet available.
