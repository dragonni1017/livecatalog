# livecatalog

Public-facing wholesale product catalog (Next.js App Router + Supabase) with a
quote-request ordering flow; admin keys approved orders into QuickBooks Desktop.

## Stack & commands

- Next 16, React 19, Tailwind 4, TypeScript. npm only (no yarn/pnpm lockfile).
- `npm run dev` / `npm run build` / `npm run lint`. Typecheck: `npx tsc --noEmit`.
- No test suite exists (no jest/vitest, no test script) — don't go looking for
  tests before or after a change.
- xlsx import/export already uses the `xlsx` npm package — reuse it, don't
  reach for a different library or re-derive parsing logic.

## Token-frugal workflow

- Read files yourself via Read/Grep/Glob by path. Never ask the user to paste
  file contents you can fetch directly.
- Use Grep/Glob first to find the right file/line, then Read only that file
  (or a narrow `offset`/`limit` range). Don't read whole directories broadly.
- For large files, read with `offset`/`limit` targeting the relevant section
  instead of reading the whole file.
- Prefer `Edit` (targeted diff) over rewriting a whole file with `Write`.
- After a Read or Edit, don't echo the full file content back in chat —
  summarize what changed or what was found instead.

## Never read these in full as text (generated/binary/large)

Hard-blocked via `.claude/settings.local.json` deny rules (which also cover
Bash `cat`/`head`/`tail`/`sed`, not just the Read tool) — see that file for
the enforced list: lockfile, build caches, `node_modules/`, `.next/`, all
`*.xlsx` (use a script or xlsx tool instead), images under `public/`, and
`docs/category-merge-backups/*.json`. For `.env` / `.env.local`, never read
or print — reference variable *names* only (grep `process.env` usage in
code, not the file itself).

## More token-saving rules

- `supabase/migrations/`: open only the one migration file relevant to the
  question, not the whole folder. Sequentially numbered (`0001`...`0006_rep_and_po.sql`
  currently) — check the highest existing number to pick the next one instead
  of listing/reading the whole folder.
- Bulk product/data work (import, sync, backfill): run the matching script in
  `scripts/*.mjs` via Bash instead of inlining/iterating the data yourself.
- `docs/*.md` (ROADMAP, handoff notes, plans): grep for the relevant heading
  first rather than reading a whole planning doc end-to-end.
- Build/typecheck/test commands: pipe through `grep`/`tail` for errors instead
  of dumping full command output into the conversation.

## Compact Instructions

When summarizing this session (auto or manual `/compact`), always preserve:
- Specific file paths touched or edited this session
- The current highest migration number in `supabase/migrations/`
- Any schema, API contract, or data-model decisions made
- Unresolved TODOs or open questions left for next session
- Which of admin/ vs (catalog)/ the work was scoped to

Discard: full contents of files already read, full command/build output,
resolved/fixed errors, intermediate exploration that didn't lead anywhere.

## Session boundaries

- Catalog UI work and admin/QuickBooks order-approval work are separate
  concerns — `/clear` between them rather than carrying one into the other.
- Nested `CLAUDE.md` files at `app/admin/CLAUDE.md` and
  `app/(catalog)/CLAUDE.md` hold area-specific rules and load automatically
  when working in that subtree; keep this root file to rules that apply
  everywhere.

## Subagents

- `.claude/agents/` defines five subagents: `catalog-ui`, `admin-quickbooks`,
  `supabase-migrations`, `data-import`, `erply-woo-integration`. Each scopes
  to one area (see its `description` field) and routes to automatically — a
  task spanning two areas (e.g. a schema change plus the admin screen that
  shows it) can invoke more than one at once. `erply-woo-integration` covers
  `lib/erply.ts`, `lib/product-sync.ts`, `app/api/sync/`,
  `app/admin/api/sync/`, and the Erply/Woo webhook routes — the sync/webhook
  plumbing gap between `data-import` (scripts) and `admin-quickbooks` (admin
  UI + order keying). No manual dispatch needed; add a new agent file here
  rather than growing one agent's scope.

## Memory graph

- `docs/memory/` holds cross-session facts CLAUDE.md shouldn't (decisions,
  gotchas, known gaps) — see `docs/memory/MEMORY.md` for the format and
  index. Check it before starting work in an area, write a node after
  finishing if something non-obvious was learned. Don't duplicate anything
  already in CLAUDE.md or derivable by reading the code.

## Maintaining this file

- Two-strikes rule: only add a new rule here the *second* time a mistake
  happens, not preemptively. Keep this file under ~200 lines — it's resent on
  every turn, so stale or speculative rules cost tokens for no benefit.
- Re-read and prune every few weeks; delete anything no longer true.

## Repo map (don't re-derive — see README.md for full detail)

- `app/` — Next.js routes: public catalog under `(catalog)/`, admin under
  `admin/` + `admin/api/`, public API under `api/`. ~39 files, 2-3 levels deep.
- `components/catalog/` and `components/admin/` — UI split by audience (~24
  files total).
- `lib/` — Supabase client, email, Erply integration, image/CDN, order rules.
- `supabase/migrations/` — applied manually in the Supabase SQL editor.
- `scripts/` — one-off `.mjs` maintenance scripts (import, sync, backfill).
- `docs/` — roadmap, feature plans, handoff notes (small, safe to read).
