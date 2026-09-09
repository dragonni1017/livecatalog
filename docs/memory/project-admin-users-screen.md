---
name: project-admin-users-screen
description: New /admin/users account-management screen (2026-09-09) — role storage convention + password-reset mechanism, separate from the staff-only accounts/route.ts
type: project
---

Built a full account-management screen at `/admin/users`, covering every
Supabase Auth account (customer + rep + admin), separate from the pre-existing
staff-only `app/admin/api/accounts/route.ts` (which hard-gates to admin/rep
and structurally can't touch a customer — left untouched).

New files: `app/admin/api/users/route.ts` (PATCH/DELETE/POST), rewritten
`app/admin/users/page.tsx` (paginates `listUsers` in a loop instead of
trusting one `perPage: 200` call), `components/admin/UsersTable.tsx` (role
filter + search, lifted interaction patterns from `AccountsTable.tsx`).

**Role storage decision:** every role check in this codebase (`middleware.ts`,
`lib/use-is-rep.ts`, `app/api/rep/auth/route.ts`) does strict equality against
`app_metadata.role === 'admin'` or `=== 'rep'` — a missing key already reads
as customer everywhere, and the 19 live customer accounts were never given
the key (organic signup doesn't set it). So demoting a rep/admin back to
`customer` **deletes** the `role` key from `app_metadata` rather than writing
the literal string `'customer'` — keeps every account's on-disk shape
consistent with the existing convention instead of adding a second way to
spell the same thing. Promoting to rep/admin still writes the literal role
string (unchanged from `accounts/route.ts`).

**Password reset mechanism:** picked the anon client's
`supabase.auth.resetPasswordForEmail(email, { redirectTo })` called
server-side from the admin route, NOT `db.auth.admin.generateLink()` —
`generateLink` mints a link but doesn't reliably mail it (it's meant for the
caller to deliver). This is the exact same GoTrue call the customer-facing
"Forgot your password?" flow already uses (`app/(catalog)/login/page.tsx`),
just triggered by an admin instead of the customer, redirecting to the same
`/reset-password` page (created earlier the same session) that already
handles all three GoTrue recovery-grant shapes (PKCE code / implicit hash /
token_hash).

**FK gotcha carried forward, not re-derived:** `order_requests.rep_user_id`
has no `on delete` clause, so deleting a rep attributed to any order throws a
Postgres FK violation — caught by matching `/foreign key/i` etc. on the
error message and returned as a clear 409 pointing at deactivate instead.
`order_requests.customer_email` is plain text (no FK), so customer deletes
never touch order history.

**Self-protection:** mirrors `accounts/route.ts` exactly — an admin can't
change their own role, deactivate themselves, or delete themselves, checked
against `getSessionUser()?.id`.
