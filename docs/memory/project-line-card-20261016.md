---
name: project-line-card-20261016
description: 2026-10-16 printable photo line card at /admin/line-card + /rep/line-card (one shared component); browser Save as PDF BY DECISION, not a server PDF; only visible + priced products; config lives in the URL
type: project
---

`components/line-card/LineCard.tsx` renders a printable product photo grid.
It's shared by `/admin/line-card` and `/rep/line-card`, and middleware gates
both paths, so there's no API route. The whole configuration is GET params
(`cat` repeatable, `skus`, `hideprices`, `instock`, `cols`, `title`), so a
built card is a shareable URL.

- **The output is the browser's "Save as PDF", by decision (2026-10-16)**,
  matching `/admin/price-list`. A server-generated PDF file was offered: it
  needs a PDF library or a headless browser on Vercel, with a second layout to
  maintain, which is roughly double the work. Don't re-propose it unless users
  ask for a real download button.
- **Images are plain `<img loading="eager">`, not `next/image`.** A lazy image
  that hasn't loaded prints as a blank box. They go through
  `resolveCdnImage(url, 400)`, per [[project-image-sizing-contract]].
- **Only active, not hidden, `price_cents > 0` products appear**, so a hidden
  or $0 product can't land on a handout. In SKU mode, anything dropped is
  listed as "Not included".
- The pack spec is split off the name at the last `' - '` when the tail looks
  like `/pk`, `bx/cs` or `cs.N` (`splitPackSpec`).
- The price is the catalog `price_cents`, not a rep tier price. Applying the
  rep's TierSwitcher tier wasn't built.
- When testing rendered HTML, count `class="..."` attribute strings, not bare
  class names: the RSC payload in the same response repeats every className,
  which roughly doubles a naive substring count.

**Why:** reps and trade shows (e.g. ASD) had only a text price list, and reps
couldn't open even that.
