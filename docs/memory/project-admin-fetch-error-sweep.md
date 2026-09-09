---
name: project-admin-fetch-error-sweep
description: 2026-09-09 — admin components swept to use lib/admin-fetch.ts's readApiError/TRANSPORT_ERROR instead of parse-before-check; one route's error shape doesn't fit the helper
type: project
---

Nearly every admin client component did `const data = await res.json(); if (!res.ok ||
data.error) throw ...` — parsing the body before checking `res.ok`, so any non-JSON
response (redirect-to-HTML-login, proxy page, empty body) threw and got mislabeled as
"Network error." Swept to `lib/admin-fetch.ts`'s `readApiError(res, fallback)` /
`TRANSPORT_ERROR` across `components/admin/*.tsx` and
`app/admin/customers/CustomerTable.tsx` — error-handling only, no URL/method/body/success
changes.

**Gotcha found:** `readApiError` only reads a JSON body's `.error` field. `POST
/admin/api/sync` (Erply "Run sync now") returns `{ ok: false, skipped: true, reason:
'...' }` (no `.error`) with 400 when Erply isn't configured — the only admin route found
that uses a different field name for its message. Converting it would silently swap that
specific message for a generic "(server returned 400)". Left `SyncControls.tsx`'s `doRun`
on the old inline pattern for this one case; `doPreview` (same file) converted fine since
its route only ever returns `.error`. Checked every other `/admin/api/*` route
(`products`, `products/create`, `stock`, `stock/bulk`, `orders`, `customers`, `accounts`,
`users`, `display-settings`, `qbwc/*`) — all consistently use `.error`, so this is a
one-off, not a pattern to keep re-checking for.

Also: `components/admin/ExcelDropzone.tsx` posts to `/api/import` and `/api/import/diff`,
which are **not** under `/admin/api/` and are exempted from the admin-session middleware
gate entirely (`pathname.startsWith('/api')` bypass in `middleware.ts`) — so the
401-session-expiry scenario this sweep was mainly about can't happen there. Converted it
anyway for the general non-JSON-body robustness `readApiError` also provides (a 502 from
a proxy, etc.), not because it was session-gated.

**Why:** `lib/admin-fetch.ts` (added prior session, `components/admin/UsersTable.tsx` was
the reference implementation) fixes admins seeing "Network error" when their session had
simply expired via middleware's 401 JSON response.

**How to apply:** if adding a new admin API route, return `{ error: string }` on failure
(not `.reason` or another field name) so client code can use `readApiError` directly. If a
future route needs a non-`.error` field surfaced to the UI, that call site should stay on
manual `res.json()` + `res.ok` handling rather than forcing `readApiError` and losing the
message — same as `SyncControls.tsx`'s `doRun`.
