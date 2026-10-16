---
name: project-promotions-20261016
description: 2026-10-16 promo codes (0064): better-of rule, atomic claim before insert, where it shows
metadata:
  type: project
---

Promo codes shipped 2026-10-16 (migration 0064, `lib/promotions.ts`, `/admin/promotions`).

- **Better of the two, never stacked** (owner's choice): per line, min(tier/customer price, code price). A wholesale buyer with a deeper tier gets nothing extra, and is told so. Rep hand-priced lines are never touched. Minimum order is checked against the pre-code subtotal.
- **The order route is the only authority.** The cart preview (`/api/cart/reprice` with `promoCode`) only reports the saving; it leaves per-item prices alone. The cart sends a code only if the preview said it applied.
- **Claiming a use:** `claim_promotion_use` RPC (an atomic `times_used < max_uses` update) runs right before `insertOrder`. It is released if the insert fails. EXECUTE is granted only to service_role/postgres; the anon key is refused (verified live). The table has RLS on with no policies (server-read only).
- An invalid/expired/capped code returns a 400 asking the buyer to remove it. A valid code that saves nothing just proceeds at normal prices without claiming a use.
- Line totals already include the saving. `promo_discount_cents` on the order is informational (order pages, QB memo "Promo CODE (-$x)"), never subtracted again.
- A used code can't be deleted, only switched off.
