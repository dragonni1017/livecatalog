---
name: project-zero-price-guards-20261026
description: 2026-10-23..26 (#164-#170) — a $0 product can no longer be shown or sold. Order submission drops $0 lines (base or volume tier); the sync hides existing visible products re-zeroed upstream; every unhide path refuses $0; the bulk "re-enable with image" button is gone. Hiding stays the first guard, orders the backstop; the cart warns buyers about lines the order will drop
type: project
---

**Why.** Erply can't take a price over the API on this account, so every
product receiving creates sits at $0 until priced by hand (see
[[project-receiving-to-catalog-20260923]]). Until 2026-10-26
`lib/order-submission.ts` checked only `is_active` and `manually_hidden`. So
"keep $0 products hidden" was the only protection, and each way of unhiding
a product was a way to sell one free.

**The layers now, from first guard to backstop:**

| Where | Guard | PR |
|---|---|---|
| Sync insert (`lib/product-sync.ts` 4b) | New product at $0 is hidden and marked `awaiting_price` | earlier; flag in #164 |
| Sync update (4c) | Existing **visible** product arriving at $0 (Erply price cleared, or `0` in an Excel import's Price) is hidden and marked `awaiting_price`; returned as `zeroPriceHidden` | #168 |
| Ready to show (`/admin/cleanup`) | Unhides only priced products hidden for want of a price | #164 |
| Products page (`PATCH /admin/api/products`, `lib/visibility-guard.ts`) | Refuses unhiding a $0 product and zeroing a visible one | #166 |
| Dashboard bulk "Re-enable products that now have an image" | Removed with its `unhide_with_image` action: it also unhid ~1,200 deliberately hidden products | #165 |
| Order submission and cart reprice (`buildLineItems`) | Drops a line whose base **or effective volume-tier** price is ≤ 0, like a hidden product | #168 |
| Cart page (`/api/cart/reprice` → `unavailable`) | Tells the buyer: lines the order would drop (hidden, inactive, $0, deleted) are marked "No longer available", left out of subtotal/promo/tax/minimum, with a Remove button | #170 |

**Non-obvious.**
- 4c is filtered to `manually_hidden = false`. A product someone hid on
  purpose must never get `awaiting_price`, or Ready to show would later
  offer it. `awaiting_price` means "hidden only because it had no price"; see
  [[project-needs-pricing-tab-20261002]].
- A volume tier can be $0 while the base price isn't, which is why the order
  guard checks the effective price.
- `/api/orders` still drops such lines without a message (it errors only
  when every line is dropped). Since #170 the cart page warns first. The
  warning comes from `unavailable` = asked-about ids missing from `prices`, so
  anything `buildLineItems` skips shows up there automatically.
- The cart only re-checks on open and on `pageshow`, not on each qty change.
  A $0 volume tier reached by raising qty in the cart isn't flagged until the
  next visit; the order still drops it.
- Rep custom-priced lines are sent to reprice so they can be flagged, but
  the client throws away their returned price. A hand price is never
  overwritten.
- The first nightly sync with step 4c is 2026-10-27 at 1 AM Pacific. Expect
  `zeroPriceHidden` empty and no "could NOT be hidden" errors. If it is
  non-empty, those were live products whose Erply price had been cleared;
  check why.
- On 2026-10-26, 0 products were visible at $0, so none of this changed
  anything live when it shipped.
