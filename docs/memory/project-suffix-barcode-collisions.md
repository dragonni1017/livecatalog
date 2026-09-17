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

**No storefront hazard — corrected 2026-09-17.** `F286411-M` was the only
VISIBLE variant ("Metallic Flower Without The Box" versus its base
`F286411`, "Iridescent Artificial Flowers with LED Lights" — genuinely
different products sharing one barcode). But **the base was already hidden**,
so the pair was never both-visible on the catalog. The first version of this
audit reported only the variant's state and never the base's, which is what
made it look live. It now tracks both, and counts BOTH-visible separately:
that figure is **0**, and was 0 before anything was changed.

`F286411-M` was hidden anyway on 2026-09-17, since it was visible carrying a
barcode that isn't its own. It also carries `stock_qty = 1000`, so it is one of
the fake-stock rows — see [[project-fake-stock-1000-hold]].

**Where the collision does persist:** both SKUs are ACTIVE in Erply (#626) and
PUBLISHED in WooCommerce (#50515). Hiding in the catalog touches neither, so
the scan ambiguity is still real in the warehouse and on the Woo storefront
another team runs. Fixing that needs the variant's own barcode.

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
