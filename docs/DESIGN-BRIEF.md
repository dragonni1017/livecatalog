# Design Brief — L&Y USA Catalog

**Status:** open, no designer assigned yet
**Last updated:** 2026-06-29
**Companion to:** `docs/ROADMAP-OPEN.md` → "Design Backlog (open)"

Reference doc for whoever (designer, dev, or future agent) picks up the open design items. Each section is: current state → what's needed → where it lives in code.

## Logo

**Current:** no real logo asset exists. Every "logo" on the site is the same CSS construct — a 40×40px (or 32/10px variants) box with `border-2 border-gray-900` and two lines of 9–10px black text, "L & Y" / "USA", set with inline `style={{ fontSize: ... }}`. It appears independently in `app/(catalog)/layout.tsx` (header), `components/catalog/Footer.tsx` (footer), and likely in admin print views (`app/admin/orders/[id]/print`, `app/admin/price-list`) — check those when a real asset replaces it.

**Needed:** a real wordmark or icon+wordmark lockup. Practical constraints: must read clearly at ~40px tall (header) and at favicon size (the current `app/favicon.ico` should be regenerated from the same mark). One light-background version is enough — the site is light-mode only (see Color section).

## Typography

**Current:** `app/globals.css` hardcodes `body { font-family: Arial, Helvetica, sans-serif; }`. There's a `@theme inline` block mapping `--font-sans` to `--font-geist-sans`, but no `next/font` import exists anywhere in the app, so that variable is undefined and the Arial fallback always wins — this isn't an intentional brand choice, it's dead scaffolding left from the create-next-app template.

**Needed:**
1. Pick one web font (a clean grotesk/humanist sans fits the existing red/black/white industrial-wholesale look — something in the Inter/Manrope/Public Sans family works without redesigning anything else).
2. Wire it via `next/font/google` in `app/layout.tsx`, expose it as a CSS variable, and point `--font-sans` at it instead of the dead Geist reference.
3. Define a small type scale (display, heading, body, caption) instead of the current per-component ad hoc Tailwind sizing (`text-xs` through `text-lg` used somewhat inconsistently across `app/(catalog)/page.tsx`, `app/(catalog)/layout.tsx`, product/category components).

## Color

**Current:** one brand color, `--brand-red: #cc1f1f` (+ `--brand-red-dark: #a81a1a`), defined in `app/globals.css`. Everything else is Tailwind's default gray scale. No dark mode — this is intentional (see the comment in `globals.css`: flipping `--foreground` to near-white broke form-input contrast), so don't reintroduce a dark theme without solving that first.

**Needed:** the red carries every CTA, link-hover, and active state right now, which is fine but means it can't also carry secondary signals (e.g. "low stock," "on sale," "new arrival" badges) without competing with buttons for attention. Consider one secondary accent — a neutral amber/gold or a dark navy would both work against the existing red/white/gray palette — reserved for status badges and promotional callouts only, never for primary actions.

## Homepage direction

**Current:** `app/(catalog)/page.tsx` (the canonical homepage as of this fix) goes: sticky header → category sidebar + best-sellers grid → price filter row → product grid → pagination. No hero, no banner, no trust signals — a buyer lands directly in the product list.

**Needed, roughly top to bottom:**
1. A slim hero/banner band above best-sellers — doesn't need to be a full-bleed image; even a single promotional/seasonal callout strip (text + one accent color) would break the "straight into a spreadsheet-like grid" feeling.
2. A trust-signal row — years in business, "trusted by N retailers," or similar — wholesale buyers vetting a new supplier look for this before they look at SKUs.
3. Keep best-sellers and the price filter where they are; both are already doing real work (best-sellers is driven by actual `analytics_events` view data, not hardcoded).

## Visual merchandising

**Current:** the only imagery anywhere on the site is individual product photos (`ProductCard`, product detail page). No category banner images, no lifestyle/contextual photography.

**Needed:** if photography exists or can be sourced, category banner images (even one per top-level category, shown on `app/(catalog)/category/[slug]/page.tsx`) would do the most to make the catalog feel merchandised rather than purely transactional. Not blocking — purely additive once assets exist.

## Loading states

**Current:** several `Suspense` boundaries fall back to `null` — content just pops in with a flash of empty space. Specifically: `SearchInput` in `app/(catalog)/layout.tsx`'s header (this one already has a real disabled-input fallback, it's fine), and `CategoryNav` + `CatalogControls` in `app/(catalog)/page.tsx`, both `fallback={null}`.

**Needed:** lightweight skeleton placeholders (gray rounded rectangles matching the real component's footprint) for those two spots. `components/catalog/EmptyState.tsx` is a good model for the level of polish to match — it's a well-built empty state, the gap is specifically the loading moment, not the "nothing found" moment.

## Quote-model clarity

**Current:** the product detail page's Add-to-Cart area has a small gray caption line noting this is a quote request, not a real purchase — easy to miss, especially for a first-time buyer who expects an e-commerce checkout.

**Needed:** promote this from a caption to a visible badge or short banner near the cart/quote CTA — something that reads at a glance as "you're requesting a quote, not paying now," ideally reusing the accent color from the Color section above so it doesn't compete with the red CTA button.

## Constraints to respect

- Light-mode only by design — don't add a dark-mode path without fixing form-input contrast first (see `app/globals.css` comment).
- Header and footer are now both rendered once, from `app/(catalog)/layout.tsx` (+ `components/catalog/Footer.tsx`) — any branding change (logo swap, font change, new nav item) should be made there once, not per-page. Pages outside the `(catalog)` route group (admin) are a separate UI and out of scope for this brief.
