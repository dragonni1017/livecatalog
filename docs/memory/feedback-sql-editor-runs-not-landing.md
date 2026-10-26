---
name: feedback-sql-editor-runs-not-landing
description: 2026-10-23..26 — four Supabase SQL editor runs reported as done never changed the live DB (migration 0067 twice, a customers delete twice). Never trust "ran it": read the change back via read-only SQL. Ask for the editor's exact result text and the project in the URL. The direct project link worked once
type: feedback
---

**What happened.** Writes to the live DB go through the user running SQL in
the Supabase dashboard (Claude's tools are read-only). Four runs the user
reported as done left the live project `aguorduaxfqrvvywgrdi` unchanged:

| Date | Statement | Result |
|---|---|---|
| 2026-10-23 | migration 0067 (`awaiting_price`), run 1 and 2 | column absent; no ALTER in the logs |
| 2026-10-26 | same, opened via `https://supabase.com/dashboard/project/aguorduaxfqrvvywgrdi/sql/new` | **landed**: 148 rows flagged |
| 2026-10-26 | `delete from public.customers where email = ...`, twice | row untouched (same id, `updated_at` unchanged) |

Nothing on the DB side explains it. No triggers, rules or FKs block the
delete. The only other project, "Task Manager", is paused. The cause is
still unknown. Candidates: the dashboard on another project, org or
account; Run not clicked; only part of the text selected; an error that
went unnoticed.

**Why it matters.** A merge that depends on a migration (as #164 did) breaks
production if the migration silently didn't apply. And a "done" fix that
isn't done stays broken.

**How to apply.**
- After any SQL the user runs, read the change back yourself with read-only
  SQL (column exists, row count, row's `id`/`updated_at`) before merging or
  reporting it fixed.
- Give the direct link to the project's SQL editor (above), not just "run
  this in the SQL editor". Ask the user to confirm the project name at the
  top says "dragonni1017's Project".
- Make statements report what they did: add `returning ...` to an update or
  delete, or follow it with a `select count(*)`. "Success. No rows returned"
  then means it hit nothing.
- When a run doesn't land, ask for the exact result text, the project name
  and whether the URL contains `aguorduaxfqrvvywgrdi`, before re-sending the
  same SQL.
- Supabase's log stream lagged ~20 min on 2026-10-26, so "no write in the
  logs" is not proof. The table is.
- Related: a write through the admin site can also silently not happen; see
  [[project-admin-login-wholesale-tier-20261026]] (confirm popup) and
  [[feedback-browser-state-change-blocked]].
