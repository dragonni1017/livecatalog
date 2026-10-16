---
name: project-ship-to-address-book-20261016
description: 2026-10-16 ship-to address book for signed-in customers (migration 0058 via Supabase MCP, verified); the cart COPIES the chosen address into order_requests.ship_*, orders never reference customer_addresses; guests still use the single localStorage address
type: project
---

Signed-in customers keep saved ship-to addresses (`customer_addresses`,
migration 0058). They manage them on `/account` and pick one in the cart.

- **Orders never point at this table.** The cart copies the picked address
  into `order_requests.ship_*` (0034) exactly as before, so editing or
  deleting a saved address can't change a past order or what goes to
  QuickBooks.
- **There's always exactly one default** while any address exists. A unique
  partial index enforces at most one. The first address saved becomes the
  default, and deleting the default promotes the oldest remaining one.
- **Cart prefill order:** the localStorage last-order address loads first,
  then the saved default overrides it once `/api/account/addresses` returns.
  The picker's selection is *derived* by matching the typed fields
  (`sameAddress`), so typing over a picked address just un-selects it. The
  "Save this address" checkbox only appears for a complete address that
  isn't already saved, and the save happens after the order succeeds.
- **Guests are unchanged.** The API 401s, the picker and checkbox stay
  hidden, and the single localStorage address still prefills.
- Verified with 19 end-to-end checks against live, using throwaway users:
  auth, another customer's ids are 404 for every verb, a bad id is 404 not
  500, default moves and promotion work, and RLS blocks the anon key. All
  test data was deleted.

**Why:** repeat wholesale buyers with several stores had one remembered
address per browser.
**How to apply:** reps placing orders for a customer can't see that
customer's saved addresses. That option was offered and not chosen
(2026-10-16), so treat it as a scoped-out follow-up, not a bug. Related:
[[project-resale-certificates-20261016]] (same per-user pattern).
