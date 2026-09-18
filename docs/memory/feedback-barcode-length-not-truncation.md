---
name: feedback-barcode-length-not-truncation
description: A short barcode is NOT evidence of truncation on this account — length varies by when the product was set up; never "repair" one from length or a check digit
type: feedback
---

Do not treat a barcode that is shorter than 12 digits as damaged data, and do
not rewrite one to "restore" a missing check digit.

**Why:** barcode length varies legitimately across this catalog depending on
when the product was set up (Dragon, 2026-09-18). On 2026-09-18 a census
found `11:11, 12:2929, 13:3, 14:1` across 2,944 barcoded products, and the
short ones cluster by prefix — a whole `91671…` cohort plus several
`73787…` — which is the signature of an era of setup, not of individual
typos.

This was learned the hard way: K229480's 11-digit `73787910121` was rewritten
to `737879101216` in both Erply and Supabase on 2026-09-17 because a
container sheet showed 12 digits, and was reverted the next day. Two pieces
of "evidence" looked convincing and were worthless:

- **A validating check digit proves nothing.** Appending the correct check
  digit to *any* 11 digits produces a valid UPC-A, so the arithmetic always
  works out. It confirms the construction, never the provenance.
- **An adjacent SKU sharing a prefix is not a second source.** K229479 being
  `737879101209` says the two were assigned near each other, not that
  K229480's stored value is wrong.

**How to apply:** a supplier sheet disagreeing with a stored barcode is a
thing to *report*, not to reconcile — which is already what the receiving
flow does, staging the line as `barcode_mismatch` and excluding it from
apply. Leave it to a human with the physical product. If a barcode ever does
need changing, note that Erply is the source of truth: `products.barcode` is
overwritten from Erply's `code2` on every daily sync
(`app/api/sync/route.ts`), so a Supabase-only edit silently reverts within a
day. See [[project-containers-20260917]] for the full episode and
[[reference-barcode-backfill-handoff]] for the separate, real leading-zero
gap.
