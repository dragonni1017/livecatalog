# Receiving workflow — improvements (2026-09-24)

Five changes that would make receiving a container easier, ranked by time
returned. Written after running six containers end to end on 2026-09-23/24,
so each one names the friction it actually removes rather than a guess.

**Status:** all five built (2026-09-24).

---

## 1. Per-container progress checklist — BUILT

**The friction.** There is no single place that says where a container is.
Answering "what does this container still need?" meant querying the database
by hand, repeatedly, and getting it wrong twice — EGSU1396926 was reported as
"still to receive" an hour after it had been applied, because the answer was
reconstructed from a stale read rather than looked up.

**The shape.** Every fact needed already exists in `shipments`,
`shipment_lines` and `products`. Nothing new is stored; it is a projection.

```
EGSU1396926   staged ✓   invoice ✗   names 4/6   categories 0/6
              created 3/6   stock applied ✓   in catalog 3/3
              photos 0/3   priced 0/3
```

**Design.** A pure `summariseShipment(lines, productsBySku)` in
`lib/receiving.ts`, next to the other predicates, so the screen and any
future caller cannot drift — the same reason `isStockAppliable` lives there.
The list endpoint returns one summary per shipment; the screen renders it in
the history row and in full for the open shipment.

**Why it is first.** It makes the other four self-evident: a column that is
always blank is a step nobody is doing. `invoice ✗` on every container is
exactly how #5's missing cost basis becomes visible.

---

## 2. Finish the job on one screen — BUILT

**The friction.** A container currently needs three screens and three
scripts, in an order that lives in someone's head:

```
/admin/receiving        stage, correct counts
/admin/quickbooks/items "Fill names from QuickBooks"
/admin/receiving        set category + price per SKU, create, apply
scripts/push-receiving-products-to-supabase.ts --apply
scripts/upload-container-photos.mjs --apply
/api/sync               (or wait for the cron)
```

**The shape.** Two buttons on the receiving screen — "Add these to the
catalog" and "Upload this container's photos" — wrapping logic that already
exists and is proven. The fill-names step could move here too; it is a
button on a different screen for no reason a user would guess.

**Open questions.** Whether the catalog push should be automatic on create
(probably not — it writes to the live catalog and deserves a decision), and
whether the photo upload should offer only files matching this container's
SKUs or the whole folder.

---

## 3. Bulk-set category — BUILT

**The friction.** Twenty `FD400*-25YARD` ribbon SKUs on one container, each
needing the same category chosen individually. Category is one of the three
things `missingForCreate` blocks on, so this is on the critical path for
every new product.

**The shape.** Row selection plus one "set category for selected" control.
Same for price, which is usually identical across a colourway run.

**Worth noting.** The 2026-09-23 containers created 85 products; at three
fields each that is 255 individual edits, most of them repeats of the row
above.

---

## 4. Warn about a duplicate container at stage time — BUILT

**The friction.** Guard A fires at apply — after the workbook is staged,
counts corrected and products created. Both Original/Arrival duplicates on
2026-09-23 were caught by hand before that point; the guard would only have
stopped them at the very end.

**The shape.** The same check the apply route runs, executed in the staging
POST, returned as a warning on the response rather than a refusal. Staging
is harmless, so this informs rather than blocks: "EGSU8096690 was already
received on the 23rd from a different file — are you sure?"

**Cheap.** `container_ref` is populated now, so it is one query.

---

## 5. Make the price round-trip verifiable — BUILT

**The friction.** Pricing must happen by hand in Erply — `saveProduct`
cannot set a price on this account, and that is closed. But nothing connects
the price someone *intended* to the price Erply ends up holding, so a typo
or a skipped row is invisible. Today's 95-product backlog is that gap made
visible.

**The shape.** Three parts, usable independently:

- Attach the Commercial Invoice during receiving (already implemented, never
  run) so `invoice_unit_price_cents` carries a real landed cost.
- Type the intended retail once, into `proposed_price_cents`, which already
  exists and is currently only ever 0.
- After a sync, reconcile: flag every product where Erply's price differs
  from what was intended, and every created product still at 0.

**Built 2026-09-24.** The first two parts already existed and were simply
unused: the Commercial Invoice attach carries unit prices, and the panel
already writes proposed_price_cents. What was missing was the check.

scripts/reconcile-prices.ts reports three numbers per product -- intended,
Erply, catalog -- and names the disagreements: MISMATCH (Erply differs from
what was decided), NOT PRICED (the manual pass has not reached it), STALE
CATALOG (priced in Erply, sync has not run), NO INTENT (created with no
price recorded). The receiving strip carries a price mismatch chip from the
same rule.

First run: all 88 are NO INTENT, which is the honest state -- nothing typed
a price during receiving before today. The report says so rather than
pretending to check.

---

## Not on this list, deliberately

- **Automating the Erply price write.** Proven impossible on this account
  (2026-09-16, six parameter combinations). Closed; do not re-probe.
- **Auto-applying stock on stage.** The human confirmation is the point —
  see the EMCU8402359 trap in `RECEIVING-PHASE-1-SCOPE.md`.
- **Auto-creating products from unmatched SKUs.** Deliberately manual: a
  wrong product in Erply propagates to WooCommerce and the catalog.
