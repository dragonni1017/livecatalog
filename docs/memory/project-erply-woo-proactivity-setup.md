---
name: project-erply-woo-proactivity-setup
description: New erply-woo-integration subagent and check-erply-woo-health.mjs script, added 2026-07-30 so Erply/Woo drift gets caught without re-deriving the investigation each time
type: project
---

Added 2026-07-30 in response to a request to be more proactive specifically
on Erply/WooCommerce integration work:

- `.claude/agents/erply-woo-integration.md` — fifth subagent, scoped to
  `lib/erply.ts`, `lib/product-sync.ts`, `app/api/sync/`, `app/admin/api/sync/`,
  `app/api/webhooks/erply/`, `app/api/webhooks/woo/`. Fills the gap between
  `data-import` (scripts) and `admin-quickbooks` (admin UI/QuickBooks keying) —
  neither of those covers the sync/webhook plumbing itself. Bakes in the
  gotchas from [[project-erply-pagination-fix]] as hard rules, requires
  checking `vercel env ls production` before deploying changes here, and
  carries a standing instruction to always state next steps/blockers/risk
  rather than just what changed.
- `scripts/check-erply-woo-health.mjs` — read-only, re-runs the same checks
  as the original investigation (image API access, inventory all-zero,
  active-but-missing-from-Erply count) so drift is detected by re-running a
  script, not by re-deriving the whole investigation. First run (2026-07-30
  evening) confirmed images still gated, inventory still all-zero, and the
  missing-from-Erply count at 143 (moved from the original 146 — expected,
  matches the 3 F286606 rows deactivated the same day, not new drift).

**Why:** the Erply integration has several facts that can silently go stale
(image access could get enabled, inventory could get entered, deactivate
candidates could grow) — without a repeatable check, the only way to know is
re-running the original one-off investigation from scratch each session.

**How to apply:** run `node scripts/check-erply-woo-health.mjs` at the start
of any Erply/Woo session (or periodically via `/loop`, not yet automated) and
compare against this node before assuming `docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md`'s
numbers are current. Update `DEACTIVATE_BASELINE` in the script (and this
node) whenever a change to the count is confirmed and explained — don't let
it silently drift out of sync with reality either.
