---
name: project-suffix-barcode-collisions
description: 2026-09-17 — 52 suffixed SKUs share a barcode with their own base; 51 are hidden and inert, F286411-M is the only VISIBLE one and the only real hazard
type: project
---

`node scripts/audit-suffix-barcode-collisions.ts [--csv] [--xlsx]` (report-only)
lists every suffixed SKU that carries the same barcode as its own base SKU.
**52 pairs across 38 barcode groups** — several bases have multiple colliding
variants (`F286557`, `F286459`, `F286567` have four each), so pair count and
group count differ.

**The only one that matters today: `F286411-M`.** It is the sole VISIBLE
variant, it is in Erply, and it shares a barcode with `F286411` — "Metallic
Flower Without The Box" versus "Iridescent Artificial Flowers with LED
Lights", two genuinely different products. A scan cannot distinguish them,
which is a live picking and receiving hazard.

The other 51 are inert: `manually_hidden` since the August orphan review, 43 of
them absent from Erply entirely, and **no variant has ever been ordered** (4
pairs have order history, all on the base SKU).

**Not duplicate listings.** Zero of the 52 share a description with their base,
so none are the same product listed twice — each is a distinct product carrying
someone else's barcode. Merging is the wrong frame; a correct barcode is the fix.

**Why:** this came out of the pack-spec rename, where the expected-name guard
skipped `F284020-LP` and `T641546-1` for being absent from Erply. Chasing those
two showed they are ordinary members of a hidden set, and that the real
exposure was a SKU nobody had asked about.

**How to apply:** don't create a hidden variant in Erply to "fix" it — it needs
a real barcode (not its base's), and `saveProduct` cannot set a price on this
account, so it would land at $0.00 with no evidence anyone wants to sell it.
Sequence is: confirm the product is real → get its own barcode → create in
Erply → set the price by hand. See [[project-duplicate-barcode-families]] for
the wider 106-group picture and [[project-orphan-sku-review-resolved]] for why
these are hidden.
