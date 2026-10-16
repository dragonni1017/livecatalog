---
name: project-dependency-security-20261016
description: 2026-10-16 npm audit 18 -> 6 (critical 0, production 1); next 16.2.6->16.3.8 (pinned), nodemailer 9->10.0.16; what's left and why: xlsx (no npm fix, decision pending) and an unfixable dev-only braces chain
type: project
---

`npm audit` went from 18 (1 critical, 14 high, 3 moderate) to **6 (0 critical,
6 high)**, and production-only went from 8 to **1**.

- **next 16.2.6 → 16.3.8, pinned exact.** That fixed a middleware/proxy
  bypass (this app's admin and rep gate *is* middleware), image-optimization
  RCE and SSRF (product photos use it), and cache poisoning. 16.3.8 is the
  oldest version that clears every advisory. 16.4.2 was a day old.
  `eslint-config-next` moved to match.
- **nodemailer ^9.0.1 → 10.0.16** (lockfile pinned; 10.1.2 was released the
  same day). The only breaking change is Node ≥ 20, and Vercel runs 24.
  Message build was smoke-tested with `jsonTransport`.
- **`npm audit fix`** (no `--force`) moved only indirect packages, plus
  vitest 4.1.9 → 4.1.12 within range.
- **Next 16.3 writes an "agent rules" block into CLAUDE.md** whenever
  `next dev` detects an AI agent. It's turned off with `agentRules: false` in
  `next.config.ts`, and verified to stay off.
- **Still open:**
  - `xlsx` 0.18.5 (high: prototype pollution, ReDoS). SheetJS stopped
    publishing to npm, and the fix (0.20.3) is only on cdn.sheetjs.com.
    Server code only *writes* xlsx. *Parsing* happens in admin browsers on
    uploaded supplier/import sheets (`ReceivingUpload`, `NewProductsPanel`,
    `ExcelDropzone`) and in `scripts/`. Switching the dependency source is
    the user's call.
  - `braces` ≤ 3.0.3 via `eslint-config-next` → `fast-glob` → `micromatch`.
    No fixed version exists (3.0.3 is the latest). It's dev-only lint tooling
    that globs our own files, so there's nothing to exploit. npm's suggested
    "fix" (eslint-config-next 14) is a downgrade, so ignore it.

**How to apply:** for future bumps, pick the oldest version that clears the
advisories and is at least a few days old. Verify with `next build`, the CI
trio and `E2E_LIVE=1 npm run test:e2e`.
