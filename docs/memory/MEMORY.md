# Memory graph — index

Cross-session project memory, separate from CLAUDE.md. CLAUDE.md holds *stable
rules*; this holds *facts that change* — decisions, gotchas, and state that would
otherwise get re-discovered or silently forgotten between sessions.

## Format

Each node is one file in `docs/memory/`, named `<type>-<slug>.md`, with frontmatter:

```markdown
---
name: kebab-case-slug
description: one-line summary, specific enough to judge relevance at a glance
type: user | feedback | project | reference
---

Fact or rule, stated plainly.

**Why:** the reason/context behind it (constraint, incident, deadline, stakeholder ask).
**How to apply:** when/how this should change future work.
```

Link related nodes with `[[other-slug]]` in the body — a link to a slug that
doesn't exist yet is fine, it just marks something worth writing later.

Types: `user` — who's involved and their context. `feedback` — corrections/
confirmations about how to approach work in this repo. `project` — live facts about
ongoing work (schema decisions, known gaps, blocked items). `reference` — pointers
to where up-to-date info lives (a doc, a table, an external system).

## Lifecycle

- Before starting a task, check this index for nodes relevant to the area you're
  touching (each subagent in `.claude/agents/` is instructed to do this).
- After finishing, write or update a node if you learned something non-obvious.
  Don't duplicate anything already stated in CLAUDE.md or derivable by reading the
  code — that's noise, not memory.
- Prune/merge stale nodes periodically, same cadence as the CLAUDE.md two-strikes
  review.

## Index

- [reference-erply-integration-status-handoff](reference-erply-integration-status-handoff.md) — READ FIRST for any Erply/catalog-data-quality work; full 2026-07-30 session handoff in docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md
- [project-credit-applications-schema-ahead-of-ui](project-credit-applications-schema-ahead-of-ui.md) — `credit_applications` table shipped (migration 0015) before the UI/flow that uses it
- [project-test-suite-drift](project-test-suite-drift.md) — `tests/` + `vitest.config.ts` now exist; root CLAUDE.md's "no test suite" line is stale
- [reference-barcode-backfill-handoff](reference-barcode-backfill-handoff.md) — where the known barcode leading-zero gap is tracked
- [project-duplicate-barcode-families](project-duplicate-barcode-families.md) — 106 barcode groups share a barcode; F286606 was a real dup-listing bug, deactivated 2026-07-30; ~103 others need review
- [reference-barcode-cross-family-collisions](reference-barcode-cross-family-collisions.md) — 41 collisions are wrong-barcode, not shared-style; 3 systematic patterns found; see docs/BARCODE-CROSS-FAMILY-COLLISIONS.md
- [project-erply-image-backfill](project-erply-image-backfill.md) — CONFIRMED 2026-08-03: Erply image API (read+write) live via saveProductPicture; 1,899 Woo->Erply done. UPDATE 2026-08-17: 168-SKU Cloudinary-only gap backfilled to Erply CDN; ROOT CAUSE FOUND — "Product image" sync is toggled OFF in the Woocommerce Integration's own Field Mapping settings (account-wide), not a bug/lag — not yet flipped on, needs Dragon's go-ahead
- [project-erply-pagination-fix](project-erply-pagination-fix.md) — 3 real-data bugs fixed 2026-07-30; stock_qty excluded from sync (see below); UPDATE 2026-08-17: 2,074 SKUs (products w/ pictures) deliberately set to fake stock=1000 in Erply warehouse 1 as a connectivity test — not real, revert path not yet run
- [project-erply-woo-proactivity-setup](project-erply-woo-proactivity-setup.md) — erply-woo-integration subagent + check-erply-woo-health.mjs added 2026-07-30 to catch Erply drift without re-deriving the investigation
- [project-erply-woo-compare-script](project-erply-woo-compare-script.md) — compare-erply-woo.mjs diffs Erply vs WooCommerce by SKU; only real gap found is category (2,870/2,870 unsynced), price/stock/name clean
- [project-erply-customer-tiers](project-erply-customer-tiers.md) — 5 tier groups + membership re-confirmed live 2026-08-03: all 3,461 customers still in Wholesale, segmentation not started, criteria not yet decided
- [project-woocommerce-tier-mapping](project-woocommerce-tier-mapping.md) — UPDATED 2026-08-04: default-to-Wholesale + Base-unused resolve 2 of 3 open items; only Retail/Exclusive still need new Woo roles; 3rd-party team now doing the Erply->Woo customer import; NOTE default tier later changed to Retail, see project-retail-anchor-pricing-flip
- [project-tier-auto-suggestion-blocked](project-tier-auto-suggestion-blocked.md) — SUPERSEDED 2026-08-04, then superseded again same day: default tier is now Retail, not Wholesale, see project-retail-anchor-pricing-flip
- [project-retail-anchor-pricing-flip](project-retail-anchor-pricing-flip.md) — 2026-08-04: pricing flipped base-is-floor->retail-is-anchor; INCIDENT same day (wrong saveProduct param zeroed all 2,871 selling prices), caught + fixed within the hour via backup CSV; discountPercent rounds to integer on this account (accepted)
- [project-orphan-sku-review-resolved](project-orphan-sku-review-resolved.md) — 2026-08-06: 143 orphan SKUs investigated + hidden via manually_hidden (confirmed live), price-only Erply->Supabase sync confirmed in sync; resolves the old "143 unreviewed" sync-enablement blocker
- [project-storefront-wholesale-quarter-rounding](project-storefront-wholesale-quarter-rounding.md) — 2026-08-06: livecatalog storefront price formula changed retail+20%markup -> actual Wholesale(-50%) price, quarter-rounded skipping .75; applied live to 2,868 products
- [project-woocommerce-customer-role-filter-bug](project-woocommerce-customer-role-filter-bug.md) — CRITICAL 2026-08-07: wc/v3/customers needs role=all or it silently hides ~3,176 Wholesale-tiered accounts; real Erply<->Woo customer gap is only ~27/50 emails, not thousands
- [project-erply-woo-customer-sync](project-erply-woo-customer-sync.md) — 2026-08-07: daily bidirectional cron (app/api/sync/customers) + lib/erply.ts customer functions + lib/woo.ts built and live; migration 0019 applied; see role-filter-bug node above before trusting any Woo customer count
- [project-erply-duplicate-customer-incident](project-erply-duplicate-customer-incident.md) — CRITICAL 2026-08-07: testing the sync route created 1,121 duplicate Erply customers; fixed + cleaned up same day; cron DISABLED (SYNC_CUSTOMERS_ENABLED unset) — read before ever re-enabling
- [project-search-mobile-lag-fix](project-search-mobile-lag-fix.md) — 2026-08-10: SearchInput.tsx no longer does a full grid-reload navigation per keystroke (was racing with continued typing on slow mobile connections); grid reload now only on Enter/search-icon submit
- [project-woo-role-write-fix](project-woo-role-write-fix.md) — 2026-08-10: assign-woo-tier-roles.mjs --apply silently no-op'd (wc/v3 role field is read-only); fixed via WP_ADMIN_APP_PASSWORD + wp/v2/users writes; 372 no-match customers are 99% no-email-in-Erply, not a sync bug
- [project-woo-category-assignment-fix](project-woo-category-assignment-fix.md) — 2026-08-10/11: WooCommerce had 0 products in any category; backfilled 2,869 via Erply groupName; 13 of 27 broken category links fixed (nav menu, mega-menu, promo blocks); 14 remain — no backing category exists, needs a business decision
- [project-plush-category-addition](project-plush-category-addition.md) — 2026-08-11: new Plush category in both catalogs, scoped differently (Supabase one-category-per-product vs WooCommerce multi-category) — see before assuming the two systems' Plush contents match
- [project-display-settings-rls-gap](project-display-settings-rls-gap.md) — 2026-08-14: display_settings had RLS enabled with 0 policies, silently no-op'ing every /admin/display-settings toggle for real visitors since 0017; fixed with a public SELECT policy; price-hide toggle added same session
- [feedback-browser-state-change-blocked](feedback-browser-state-change-blocked.md) — Claude Code's harness classifier can deny state-changing browser clicks (plugin deactivate, etc) on live sites even after chat approval; don't route around a block
- [project-woo-price-integration-markup-bug](project-woo-price-integration-markup-bug.md) — UPDATED 2026-08-17: full-catalog check confirms Erply->Woo sync is clean (bug is Woo-side display/API filtering only, still unresolved); a second team now owns the live WooCommerce site — NEVER attempt a live plugin toggle from this repo's sessions
- [project-woo-direct-outofstock-write](project-woo-direct-outofstock-write.md) — 2026-08-17: first direct-to-Woo write in this repo; WooCommerce silently reverts stock_status writes for manage_stock=true products back to instock based on quantity — only 66/141 (the drafts) actually stuck, 75 live products left alone by decision
- [project-erply-sync-category-safety](project-erply-sync-category-safety.md) — 2026-08-18: Erply->Supabase sync (app/api/sync/route.ts) much closer to safe than old docs implied; found+fixed a real category-fragmentation bug (resolveCategories matched by stale slug, would've duplicated 8 categories) plus added an Erply-groupName alias map and insert-only category assignment
- [project-f287569-erply-orphan-barcode-anomaly](project-f287569-erply-orphan-barcode-anomaly.md) — 2026-08-19/20: F287569 doesn't exist in Erply at all; its barcode is a duplicate of unrelated product D701113's -- confirmed the bad data is in Supabase itself, needs physical/supplier check
- [project-erply-sync-id-default-outage](project-erply-sync-id-default-outage.md) — 2026-08-20: daily Erply->Supabase sync had been a total no-op since 08-05 (products.id had no default, broke every upsert silently); fix (migration 0020) already existed unapplied, applied now, full sync + all prices re-verified correct
- [project-rep-price-tier-and-qbwc-plan](project-rep-price-tier-and-qbwc-plan.md) — 2026-08-20: rep-tier % were WRONG (built vs Retail, stored base is actually Wholesale) -- found + fixed + verified same day; QBWC real hardware test done 2026-08-20/21, several live QB rejections fixed, now confirmed working (4/4 orders acked, 0 errors) -- plan at C:\Users\Dragon\.claude\plans\synthetic-greeting-blum.md
