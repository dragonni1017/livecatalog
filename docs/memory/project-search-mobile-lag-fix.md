---
name: project-search-mobile-lag-fix
description: 2026-08-10 -- SearchInput.tsx no longer pushes a full grid-reload navigation on every keystroke; fixed apparent "dropped keystrokes" on mobile
type: project
---

**What happened:** Dragon reported the catalog search box lagging and
dropping keystrokes on mobile specifically. Root cause was in
`components/catalog/SearchInput.tsx`: every keystroke fired two independent
debounced actions — a lightweight `/api/products/suggest` fetch (250ms) for
the autosuggest dropdown, AND a `router.push('/?q=...')` (300ms) that
re-runs `app/(catalog)/page.tsx`'s full server-side Supabase query
(`force-dynamic`) and re-renders the whole grid.

The component also has a render-phase effect (no `useEffect`, runs inline
during render) that syncs the input's local `value` state from
`searchParams` whenever the URL's `q` changes, to support browser
back/forward. On a slow (mobile) connection, the `router.push` round-trip
can take long enough that the user types further characters before it
resolves; when it finally resolves, the searchParams-derived `urlQ` is the
*stale* debounced value from before those extra keystrokes, and the
render-phase sync overwrites `value` with it — reading as the input
reverting/eating keystrokes. Reproduced conceptually: on desktop with a fast
localhost round-trip this never surfaces, which is why it only showed up as
a mobile complaint.

**Fix:** removed the per-keystroke `router.push` (renamed to
`submitSearch`, no longer debounced-and-auto-fired). The product grid now
only reloads on an explicit submit — Enter key or tapping the (now
functional, `type="submit"`) magnifying-glass icon, both wired through a new
`<form onSubmit>` wrapper so the mobile keyboard's own Search/Go action
button also submits correctly. The autosuggest dropdown fetch is untouched
and still fires live per keystroke (250ms debounce) — it's cheap and
doesn't touch the grid or `value` state, so it wasn't part of the bug.
`handleKeyDown`'s Enter branch previously only worked when the dropdown was
open with results (`if (!open || results.length === 0) return` short-circuited
it); fixed so Enter always submits regardless of dropdown state.

Verified via Chrome automation against the local dev server: typing no
longer fires any grid navigation (only the suggest XHR), Enter and the
search-icon tap both correctly update the URL and reload the grid.

**Why:** per-keystroke full-page navigation is inherently racy with
continued typing once the round-trip is slow enough (any real mobile
network); debouncing the trigger doesn't fix the race, it just narrows the
window.

**How to apply:** if `SearchInput.tsx` or the catalog grid's data-fetch path
changes again, keep the invariant that `value` (what's rendered in the box)
is never overwritten by a response to a request that could be older than
what the user has since typed. Prefer explicit-submit patterns over
debounced-navigation patterns for anything that triggers a full
server-component reload on mobile-facing pages.
