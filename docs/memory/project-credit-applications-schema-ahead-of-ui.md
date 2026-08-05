---
name: project-credit-applications-schema-ahead-of-ui
description: credit_applications table exists (migration 0015) but the net-terms/credit-application UI flow is still an open ROADMAP item, not built
type: project
---

`supabase/migrations/0015_credit_applications.sql` has already been applied, so the
`credit_applications` table exists in the schema. But `docs/ROADMAP-OPEN.md` still
lists "Net-terms / credit application form" as a Recommended Next item, pairing it
with a future `customers.credit_limit` column — meaning the table was shipped ahead
of the actual UI/flow that uses it.

**Why:** worth flagging so a future session doesn't assume "table exists" means
"feature is live," or duplicate a migration that's already there.

**How to apply:** when picking up the net-terms/credit-application feature, start
from the existing `credit_applications` table and check what columns it already has
before adding new migrations. See [[reference-barcode-backfill-handoff]] for another
example of schema/feature gaps in this repo.
