# app/admin — admin & order-approval area

Root CLAUDE.md rules still apply; this adds admin-specific context only.

## Scope

- Order review/approval flow: admin reviews quote requests, approves them,
  which keys them into QuickBooks Desktop.
- `admin/api/` — server routes for approval actions, QuickBooks key export,
  admin auth.

## Rules specific to this area

- Never fabricate or guess QuickBooks field mappings — check the existing
  Erply/QuickBooks integration helpers in `lib/` before writing new
  export/key code.
- Order approval is a one-way action (keys into QuickBooks) — treat any
  change to the approval endpoint as high-risk; confirm the diff carefully
  and flag anything touching this path in your summary even if not asked.
- Admin auth/session logic lives in `lib/` — read the specific auth helper
  file, not the whole directory.
