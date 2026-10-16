---
name: project-visitor-funnel-20261016
description: 2026-10-16 visitor funnel on /admin/analytics (#117); tracking started 2026-10-16, 0056 applied via the Supabase MCP not the SQL editor (user's editor run never landed); every /api/track insert now needs analytics_events.visitor_id
type: project
---

The **Visitor funnel** section on `/admin/analytics` counts distinct
anonymous visitors per step (visited → added to cart → opened cart →
submitted quote). Shipped in #117. The visitor id is a random UUID in
localStorage (`lyu_vid`, `lib/track.ts`) with no personal data.

- **Funnel data starts 2026-10-16.** Older `analytics_events` rows have
  `visitor_id` null and are ignored, so an empty or small funnel before
  then isn't a bug. The 8 test events from verification were deleted.
- **Migration 0056 was applied through the Supabase MCP**
  (`apply_migration`), not the SQL editor. The user's editor run reported
  done, but none of it was in the live project (wrong project, partial
  selection, or rolled back; never pinned down). It was verified live
  afterwards.
- **`/api/track` writes `visitor_id` on every insert.** Any rollback of
  0056 (or recreating the table) silently stops ALL tracking, views and
  searches included, because the route swallows insert errors.
- `add_to_cart` fires from `lib/cart-context.tsx` `addItem`, at most once
  per 5s, so reorder, CSV upload and drafts count, and a big reorder can't
  trip the 60/min rate limit. Steps aren't strict subsets of the step
  above (Quick Order skips the product page).
- The funnel undercounts by design: one buyer on two devices is two
  visitors, and private windows get a new id each page load. Reps placing
  orders count as visitors. The page shows the real `order_requests` count
  beside the funnel as a check.

**Why:** the page had views, searches and orders only as unrelated totals,
with no cart signal and no way to link one visitor's events.
**How to apply:** after a migration the user reports running, verify it in
the live project before merging code that depends on it. See
[[project-api-route-auth-audit-20261001]] for the track route's rate limit.

**QR scan tracking (later 2026-10-16, migration 0062 `analytics_events.source`).**
Line-card QR codes link to `/product/<id>?src=qr` (`lib/qr.ts qrProductUrl`).
`TrackView` sends that view with `source: 'qr'`, then strips `src` from the
address bar so a copied link doesn't count as a scan. `/api/track`
whitelists sources (only `qr`; anything else is stored as null).
`lib/funnel.ts summarizeFunnel` (pure, tested) feeds the "From printed line
cards (QR)" row on /admin/analytics.
- **Bug caught in a real browser:** one scan logged **two** views (`qr` +
  untagged). The effect re-ran on the cleaned URL (React's dev
  double-invoke, or any remount). Fixed by also setting the plain
  `tracked_view:<id>` session key when a scan is recorded. Re-verified in
  Chrome: one scan gives exactly one `qr` event. Unit tests can't see this
  (no DOM env in vitest), so re-check in a browser if TrackView changes.
- 0062 was applied BEFORE the code that writes `source`, since a missing
  column fails all tracking silently.
