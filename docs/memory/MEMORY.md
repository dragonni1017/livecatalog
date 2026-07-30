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
- [project-erply-image-backfill](project-erply-image-backfill.md) — Erply image API access pending; download/upload scripts scaffolded for the 1,842 SKUs missing image_url
- [project-erply-pagination-fix](project-erply-pagination-fix.md) — 3 real-data bugs fixed 2026-07-30; dry run confirms real sync today would wipe 1,028 image_urls + all 2,870 stock_qty — DO NOT enable sync yet
