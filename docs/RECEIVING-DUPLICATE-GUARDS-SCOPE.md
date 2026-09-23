# Receiving — duplicate-apply guards (2026-09-23)

**Built 2026-09-23.** Scoped and implemented the same day, closing the gap
that let 5,200 pieces be added to Erply twice.

Proof it works, run against live data with today's six registration
documents excluded — i.e. the history exactly as it stood when the mistake
was made:

```
EMCU8323054     31 rows -> clean
EGSU8096690     38 rows -> clean
EGSU1396926      7 rows -> clean
TIIU5073956      5 rows -> clean
TXGU6094406      8 rows -> clean
EMCU0137238     13 rows -> clean
EGSU9509206     14 rows -> WARN on 4: D701027 2160, F287862 720,
                                      F287866 720, F288017 1600
```

Exactly the four duplicated rows, on the one container that was duplicated,
with no false positive on any of the five legitimate ones. Guard A
separately flags both abandoned Original-List shipments.

Note when reading a simulation like that: a shipment that has ALREADY been
applied will self-match, because its own registration document is in the
history. A real first apply cannot — its document does not exist yet. Judge
a guard only against history that predates the apply being tested.

## What actually happened

Three distinct duplicate classes surfaced in one day.

| # | Class | What it was | Caught by | Cost |
|---|---|---|---|---|
| 1 | **Script got there first** | EGSU9509206's arrival list was stocked by `scripts/add-stock-from-arrival-lists.mjs` on 09-03, then received through the UI on 09-23 | nothing — found by hand afterwards | **5,200 pieces double-added**, corrected by write-off doc 5 |
| 2 | **Two files, one container** | EGSU8096690 and EMCU8323054 staged again from the supplier's *Original List* after being received from its *Arrival List* | nothing — found by hand, before apply | 165,896 pieces of near-miss |
| 3 | **Concurrent create** | F288132 created twice in Erply, same `code` and `code2` | nothing — Erply's own uniqueness check did not stop it | 1 orphan product, no stock impact |

Class 3 is Erply-side and out of scope here. Classes 1 and 2 are ours.

## Why the existing guards miss them

`app/admin/api/shipments/apply/route.ts` has three defences, and all three
are about *one shipment row*:

1. `shipments.status` must be `staged` — stops re-applying the same row.
2. `shipment_lines.applied_at` per line — stops re-adding a line.
3. `shipments.file_hash` unique — stops re-uploading the same *file*.

Class 2 defeats #3 because the two files genuinely differ; the hash is
doing exactly what it was designed to do. Class 1 defeats all three
because a script writes to Erply directly and leaves **no `shipments` row
at all** — from the app's point of view that container was never received.

The human gate (`confirm_not_yet_received`, a checkbox that disables the
apply button) is real and working. It just asks the wrong question: it
asks whether the goods have arrived, not whether they were already keyed.

## Guard 0 — populate `container_ref` (prerequisite)

`shipments.container_ref` exists in migration 0048, the API accepts it, and
the UI sends it — from a text box the user is expected to type into.
**All 9 shipment rows have it null.** Meanwhile every filename in this
workflow carries the container: `... Cntr#EGSU9509206 MBL#...`.

- Derive it server-side in `POST /admin/api/shipments` from `file_name`
  (`/Cntr#(\w+)/`), using the typed value only as an override.
- Backfill the 9 existing rows with a script.
- Without this, Guard A has nothing to match on.

Deliberately server-side: the parse must be the same for every caller, and
the UI already proved that an optional field stays empty.

## Guard A — this container already has an applied shipment

Pure DB, no API call. Before applying, look for another shipment with the
same `container_ref` and `status = 'applied'`.

- Match found → refuse with a 409 naming the other shipment (its file name
  and `applied_at`), unless the caller passes
  `confirm_container_already_applied: true`.
- Surfaced in the UI as a blocking panel, with its own checkbox, separate
  from the existing one. Two different questions, two different boxes.
- **False positive to accept:** a container genuinely received in two
  parts. Rare, and the confirm path exists for it.
- Also worth showing at *stage* time, not just apply — the earlier the
  warning, the less work is wasted.

## Guard B — Erply already registered these exact rows

The real fix, because it does not care what created the stock — script, UI,
another integration, or a person in Erply.

Every stock addition creates an inventory registration document with rows
of `(productID, amount)`. Before applying, compare the rows this apply
*would* write against what Erply already holds.

- New `lib/erply.ts` export, something like
  `findPriorRegistrations(items, { sinceDays })` → for each intended
  `(productId, addQty)`, any existing document containing the same
  productID with the **same amount**.
- **Equal amount is the signal.** Equal means one shipment counted twice;
  a different amount means the SKU genuinely arrived on two containers.
  This is exactly the rule `scripts/writeoff-double-added-stock.mjs`
  already uses, and it correctly left `P273810-60cm` alone (1,056 then
  372) while catching all four real duplicates.
- Matches → 409 listing SKU, amount, and the prior document's id and date,
  unless `confirm_already_registered: true`.
- Cost: one `getInventoryRegistrations` call with `getRows=1`. 51 documents
  today. Needs pagination and a `sinceDays` window (180?) so it stays
  bounded as documents accumulate.
- **False positive to accept:** two real shipments of the same SKU that
  happen to carry the identical quantity. Plausible for round numbers like
  a full case pack, so this must warn-and-confirm, never hard-block.

Guard B subsumes Guard A in coverage, but not in quality of message: A can
say "you already received this container on the 23rd", B can only say
"these 4 products already have this quantity". Both are worth having, and A
costs almost nothing once Guard 0 is in.

## Deliberately not in scope

- **Retrofitting shipment rows for script-applied containers.** Tempting,
  but it would be fabricating history for 7 August containers, and Guard B
  already covers them by reading Erply directly.
- **Blocking on a past ETA.** Considered and rejected: EGSU9509206's ETA
  was 09-02, but legitimately late containers exist, so it would cry wolf.
- **Anything about Erply's own duplicate-`code` behaviour** (class 3).

## Files this touches

| File | Change |
|---|---|
| `app/admin/api/shipments/route.ts` | derive `container_ref` from `file_name` on POST |
| `app/admin/api/shipments/apply/route.ts` | run both guards before the status flip; two new confirm flags |
| `lib/erply.ts` | `findPriorRegistrations()` + a typed registration-document shape |
| `lib/receiving.ts` | the pure "is this a duplicate row" predicate, so the UI and route cannot drift (matches how `isStockAppliable`/`isCreatable` already work) |
| `app/admin/receiving/ReceivingUpload.tsx` | warning panels + checkboxes; show the container warning at stage time too |
| `tests/receiving.test.ts` | predicate tests, including the equal-vs-different amount case |
| `scripts/` | one-off backfill of `container_ref` on the 9 existing rows |

No migration: `container_ref` already exists.

## Testing

The duplicate predicate is pure and belongs in `tests/receiving.test.ts`
with the existing receiving rules. The cases that matter are the ones real
data produced today: equal amount → duplicate; different amount → not;
same SKU absent from prior documents → not; and a prior document older than
the window → not flagged.

End-to-end, the honest test is a dry run against the live registration
history: assert that a re-apply of EGSU9509206 would now be caught.

## Effort

Roughly a day, weighted toward Guard B and the UI. Guard 0 is an hour and
is worth doing on its own even if the rest waits — `container_ref` being
null is silently degrading the audit log too, which falls back to the raw
file name.
