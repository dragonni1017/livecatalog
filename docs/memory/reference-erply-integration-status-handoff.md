---
name: reference-erply-integration-status-handoff
description: single entry point for all Erply integration + catalog data-quality work from the 2026-07-30 session — read this first
type: reference
---

`docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md` is the narrative summary of a full
session's work getting the Erply integration ready: real credentials now in
`.env.local`, three bugs fixed in `lib/erply.ts`
([[project-erply-pagination-fix]]), an image backfill pipeline built but
blocked on Erply enabling access ([[project-erply-image-backfill]]), and a
catalog data-quality pass that found real duplicate listings
([[project-duplicate-barcode-families]]) and wrong-barcode collisions
([[reference-barcode-cross-family-collisions]]).

**Why:** this spans multiple areas in one session (Erply sync code, admin
data quality, catalog integrity) rather than being cleanly scoped to one —
worth reading the handoff doc in full rather than just one memory node, since
the pieces depend on each other (e.g. don't fix the stock field bug and
assume stock is fine — it's fixed *and* still reads 0 because Erply's actual
inventory is empty).

**How to apply:** before starting ANY Erply-related or barcode/duplicate
-related work in this repo, read `docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md`
first — it has a prioritized TODO list and explicitly states what must NOT
be done yet (don't trigger `app/api/sync/route.ts` for real).
