---
name: project-resale-certificates-20261016
description: 2026-10-16 resale/tax-exempt certificate upload (migration 0057, applied via Supabase MCP and verified live); private bucket, signed-URL upload/view, review status is a RECORD ONLY (no email, no QuickBooks tax flag); first private bucket in the project
type: project
---

Signed-in customers upload a resale / tax-exempt certificate on `/account`.
Admins see a badge on `/admin/orders/[id]` and review on
`/admin/resale-certificates` (Verify / Reject / Reopen).

- **First private storage bucket** (`resale-certificates`: 10 MB, PDF/JPG/PNG
  only, enforced by the bucket). `product-images` is public. No storage
  policies are needed: uploads use a signed upload URL minted server-side,
  and admins view through a 5-minute signed URL
  (`/admin/api/resale-certificates/<id>/file`).
- **Ownership is the folder.** Files live at `<auth user id>/<uuid>.<ext>`,
  and `save` only accepts a path in the session user's own folder. Rows link
  to orders by **lowercased email** (orders have no user id).
- **Review status is a record only**, same as net-terms
  ([[project-net-terms-approval-flow]]). No email is sent, and nothing marks
  the customer tax-exempt in QuickBooks; that's still keyed by hand.
- 0057 was applied via the Supabase MCP and verified (bucket private, RLS on,
  0 policies, grants to all existing roles). A 24-check end-to-end test ran
  against live with throwaway `@example.com` users, covering auth, other-user
  paths, traversal, type limits, replace, and anon read/download/public URL
  all refused. Everything it created was deleted.
- Guests can't upload (they have no session to tie the file to). Expiry
  reminders weren't built. Both are out of scope.

**Why:** wholesale buyers need a certificate on file, and it had been
handled over email outside the app.
**How to apply:** don't make the bucket public or add read policies to
`resale_certificates`: the files carry tax IDs. Before wiring status into
pricing or QuickBooks, treat it like the deferred net-terms wiring and ask
first.

**Expiry emails (later 2026-10-16, migration 0063).** `lib/cert-reminders.ts`
runs in the nightly `/api/sync` (both paths). It sends a **reminder** once at
≤30 days before `expires_on` (LA date), and an **expired notice** once, only
within 30 days after expiry, so certificates that expired before this
shipped get no surprise mail. It skips rejected, replaced and undated
certificates, and caps at 50 per run. `reminder_sent_at` and
`expired_notice_sent_at` are stamped **only after a successful send**, so a
failure retries the next night and marks the sync run `partial`. A new
upload is a new row, so the cycle restarts. It only emails when
`isSmtpConfigured()`. The live check used a fake sender, so no real email
was sent.
