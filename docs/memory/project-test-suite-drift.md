---
name: project-test-suite-drift
description: tests/ directory and vitest.config.ts now exist in the repo, contradicting root CLAUDE.md's "no test suite exists" line
type: project
---

Root `CLAUDE.md` (Stack & commands section) says "No test suite exists (no jest/
vitest, no test script) — don't go looking for tests before or after a change." As
of 2026-07-02 a `tests/` directory and `vitest.config.ts` exist in the repo root.

**Why:** CLAUDE.md is meant to be pruned/re-read periodically but this line hasn't
caught up yet — following it literally would mean ignoring a real test setup.

**How to apply:** before assuming there's no test suite, check `ls tests/` and
`package.json` for a `test` script. If a suite is genuinely in place now, update
root CLAUDE.md's Stack & commands section to match and remove this node.
