# app/(catalog) — public-facing catalog area

Root CLAUDE.md rules still apply; this adds catalog-specific context only.

## Scope

- Public wholesale product catalog and the quote-request ordering flow
  customers use before anything reaches admin approval.
- No auth — this is the public surface. Treat all user input as untrusted
  (search/filter params, quote-request form fields).

## Rules specific to this area

- Product images/pricing come from Supabase — check the `lib/` Supabase
  client and existing catalog queries before writing new fetch logic.
- Quote-request submissions do NOT touch QuickBooks directly — they go into
  a pending state for admin review (see `app/admin/CLAUDE.md`). Don't add
  logic here that assumes direct QuickBooks access.
