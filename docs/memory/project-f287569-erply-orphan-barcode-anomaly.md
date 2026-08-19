---
name: project-f287569-erply-orphan-barcode-anomaly
description: F287569 doesn't exist in Erply under any identifier; its Supabase barcode belongs to a different, unrelated Erply product (D701113) -- needs a physical check, not a guessed fix
type: project
---

Found 2026-08-19 while extending a 46-SKU manual category correction
(Dragon's spreadsheet edit, see [[project-erply-sync-category-safety]]
for the general sync-safety context) from Supabase+WooCommerce to Erply.
44 of 46 propagated cleanly; F287569 and B325098 were excluded.
B325098's gap is mundane (target category "Gifts" has no real Woo/Erply
equivalent, only Supabase). F287569 is a genuine anomaly.

**What was checked, all negative:** `getProducts` by exact code
(`F287569`), by case/whitespace variants, by barcode (`code2`, exact and
with leading-zero variants), by product-name search
("White Heart-Pattern Pull Flower Ribbon..."), and by scanning every
product in Erply's "Ribbons" group (productGroupID 47) by name. F287569
does not exist in Erply under any identifier.

**The barcode collision:** Supabase's F287569 row has barcode
`737879096895`. Looking that barcode up in Erply (`code2` field) returns
a completely unrelated product: **D701113, "3mm & 8mm Beige DIY Pearl
Beads."** Not a shared-family/variant situation like the other 56
documented cross-family collisions in
[[reference-barcode-cross-family-collisions]] — different product
category entirely, no plausible relation.

**Best read of what happened:** F287569 looks like a genuine sibling of
F287570 (already correctly in Erply: "White & Gold Heart-Pattern Pull
Flower Ribbon with Gold Edge," barcode `737879096901` — 6 higher than
F287569's, consistent with sequential SKU/barcode assignment within a
product family). F287568 also doesn't exist in Erply. Most likely:
F287569 was created in Supabase/the catalog but never actually imported
into Erply, and its barcode field was mistakenly filled with a value
that belongs to an unrelated existing Erply product (D701113) rather
than its own true barcode.

**Not fixed — needs a physical/supplier check**, same category as the
6 held-back duplicate-barcode price-mismatch candidates and the 56
cross-family collisions: only someone who can look at the actual
product/packaging (or a supplier invoice) can determine F287569's real
barcode and whether it should be created in Erply at all.

**How to apply:** if this comes up again, don't re-run the same lookup
sweep — it's already exhaustive and consistently negative. The open
question is purely "what is F287569's real barcode, and does it need an
Erply product created" — that's a business decision made after seeing
the physical item, not more data digging.
