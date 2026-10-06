---
name: project-label-reader-20261006
description: 2026-10-06 scripts/read-product-labels.ts reads L&Y label photos with Claude vision into fill-sheet suggestions; built + merged (#99) but NEVER RUN against the API -- no ANTHROPIC_API_KEY on this machine yet
type: project
---

`scripts/read-product-labels.ts` (#99) reads the L&Y label block on a product
photo (SKU, UPC, item size, "12/bag", "20bags/cs", "240/cs") and writes
suggestions into a COPY of the QB fill sheet (`...-labels.xlsx`), or with
`--dir=` a readings CSV for any folder of photos. Preview by default; `--run`
spends money (~$0.03/photo on claude-opus-5-5, 114 photos ~ $3.33 on the
2026-10-01 sheet). Readings are cached by file hash in
`data/label-readings-cache.json`.

**Status:** never run against the API. `ANTHROPIC_API_KEY` is not set in
`.env.local` and there is no `ant auth login` profile. Dragon has to add it; it
is billed to the Anthropic API account, not the Claude subscription. Next step
once it exists: `--run` on the 10 hand-checked SKUs below and compare, then the
full sheet.

**Hand-read 10-photo sample (2026-10-06), the baseline to compare against:**
- Labels give category almost every time, but a complete pack spec only on
  2/10 (K229532 `12/bag 20bags/cs`, S162819 `6/box 6bxs/cs`). 3D801402's
  48/pk comes from the display-box print, not the label. Most labels print only
  `N/cs`, so pieces-per-pack stays the main gap. A "sold singly" `1/pk Nbx/cs`
  rule per family (like the approved plush rule) is the open decision.
- Label vs QuickBooks conflicts found: K229497 label 240/cs (QB 40 is a typo),
  F287675 label "150 pcs/cs" vs QB "150 pk's/cs", F288023-VLT label lists 6
  sizes S-XXXL vs QB "5 Piece Set".
- Every label carries a UPC. New QB products are created with no barcode
  (code2), so label UPCs are a possible barcode source. Not decided.

Not obvious from the code: the SDK's "no credentials" failure is a plain Error
(credentials file not found), not `AuthenticationError`. The script matches
both and exits before every photo fails. See
[[project-qb-product-create-plan-20261001]].
