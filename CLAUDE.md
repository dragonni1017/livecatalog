# livecatalog

Public-facing wholesale product catalog (Next.js App Router + Supabase) with a
quote-request ordering flow; admin keys approved orders into QuickBooks Desktop.

## Stack & commands

- xlsx import/export already uses the `xlsx` npm package — reuse it, don't
  reach for a different library or re-derive parsing logic.

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
  question, not the whole folder. Sequentially numbered — check the highest
  existing number to pick the next one instead of listing/reading the whole
  folder. Applied manually in the Supabase SQL editor, not via CLI.
- New table read by the public catalog (not just admin): `enable row level
  security` alone leaves it unreadable by the anon-key client with no error,
  just silent empty results — add an explicit public SELECT policy (mirror
  `products`/`categories`'s `Public can read ... (roles: public, qual:
  true)`). Bitten twice (`display_settings` 2026-08-14, `product_categories`
  2026-08-21) — after any such migration, load the actual public homepage
  and confirm real product counts before considering it done, not just a
  clean migration apply + typecheck.
- ANY new table (admin-only included) needs table grants in the migration —
  this project does not hand them out. Without them PostgREST omits the
  table from its schema cache and *every* query returns PGRST205 "Could not
  find the table 'public.<t>' in the schema cache", which reads exactly like
  the migration never ran; reloading the cache does nothing. Three traps,
  all hit on `bins`/`bin_types` 2026-09-14:
  - **Don't name roles from memory.** This project has **no `service_role`
    role** (it uses the newer publishable/secret API keys). Mirror whatever
    `products` has instead: `select grantee, privilege_type from
    information_schema.role_table_grants where table_name = 'products';` —
    `products` is reachable through the app's key, so its grantees are the
    ones that matter.
  - **A multi-role grant is all-or-nothing.** `grant ... to anon,
    authenticated, service_role` fails entirely on the missing role and
    grants nothing, silently. Worse, the Supabase SQL editor runs a script
    in ONE transaction, so a failed grant at the bottom rolls back the
    `create table` at the top — the migration "succeeds" and leaves nothing.
    Loop over `pg_roles` and skip roles that don't exist.
  - **`{ count: 'exact', head: true }` hides the failure.** A HEAD response
    has no body for supabase-js to parse the error from, so it returns
    `error: null, count: null`. A null count with no error means the query
    failed — this misdiagnosis cost three wrong fixes in a row.
- New table with FKs to two tables that PostgREST already auto-embeds
  elsewhere via shorthand (e.g. `category:categories(...)`): grep the whole
  codebase for that shorthand and disambiguate every hit with
  `!<fk_constraint_name>` *before* deploying — a second valid relationship
  path makes every existing embed error with PGRST201 ("more than one
  relationship was found"), breaking every query using it, not just new
  code. Caused a brief live outage on `product_categories` (2026-08-21).
- Inserting products: `products.id` has a `prod-NNNNN` default fed by
  `products_id_seq`, and scripts that hand-assign ids (`max+1`) don't advance
  it — the sequence eventually lands inside a hand-assigned block and every
  insert dies with `duplicate key ... products_pkey`. supabase-js upserts in
  chunks of 500 and one bad row fails the whole chunk, so this also silently
  loses hundreds of unrelated *updates*; the only sign is `errors[]` in the
  sync response. Re-run `0052_products_id_seq_reseed.sql` after any script
  that assigns ids by hand. Bitten twice (0020 no-default 2026-08-05,
  sequence collision 2026-09-23).
- Bulk product/data work (import, sync, backfill): run the matching script in
  `scripts/*.mjs` via Bash instead of inlining/iterating the data yourself.
- `docs/*.md` (ROADMAP, handoff notes, plans): grep for the relevant heading
  first rather than reading a whole planning doc end-to-end.
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

