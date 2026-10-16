---
name: reference-testing-and-ci
description: Where tests live and what runs when — offline vitest suite + GitHub Actions CI (since 2026-10-16), opt-in live e2e script; how to test a public route's guards without a DB
type: reference
---

- **`tests/*.test.ts` (vitest, `npm test`)** are offline unit tests: 30 files
  and 413 tests as of 2026-10-16, running in about a second. Env is stubbed
  per test. Nothing touches Supabase.
- **`.github/workflows/ci.yml`** runs typecheck, `npm test` and `npm run lint`
  on every PR and on every push to `main`, with no secrets. Lint *errors*
  fail it; warnings (unused vars in one-off `scripts/`) don't. `next build`
  isn't run there, because Vercel previews build every PR.
- **`scripts/e2e-live.mjs` (`E2E_LIVE=1 npm run test:e2e`)** runs against
  the **live** project. It needs `npx next dev -p 3456` running first. It
  creates `e2etest-*@example.com` users, exercises certificates, the address
  book, the line card and funnel tracking with real session cookies, then
  deletes everything (and sweeps a crashed run's leftovers at start). It
  never runs in CI, and refuses to start without `E2E_LIVE=1`.
- **Pattern for public `/api/*` route guards**
  (`tests/account-routes.test.ts`): mock `lib/auth-server` for the session,
  and mock `getAdminClient` with a Proxy that **throws on any access**. Each
  rejection case then also proves the request never reached the DB. Verified
  by breaking two guards on purpose: the tests failed.
- `/api/track` is tested in mock mode (`NEXT_PUBLIC_SUPABASE_URL` stubbed
  empty). It validates exactly as in prod but doesn't insert. Use a fresh
  `x-forwarded-for` per request, or the module-level 60/min limiter kicks in.

**Why:** a session on 2026-10-16 wrongly claimed the repo had no tests, and
wrote and deleted a throwaway live-check script for every feature.
**How to apply:** check `tests/` before saying something is untested, and
extend the suite or `e2e-live.mjs` instead of writing one-off checks.

**Branch protection on `main` (since 2026-10-16):** the CI job `check`, from
the GitHub Actions app (app_id 15368), must pass before anything lands on
`main`. Direct pushes are rejected too ("Required status check "check" is
expected"), so every change goes through a PR. `enforce_admins` is on, so the
owner can't bypass it either. Force-push and deletion of `main` are blocked.
There's no review requirement (one developer can't approve their own PR) and
no "up to date" requirement, so merges don't need a rebase first. A
`gh pr merge` fails while `check` is still pending: wait for it, then merge.
To change the rule: `gh api repos/dragonni1017/livecatalog/branches/main/protection`.
