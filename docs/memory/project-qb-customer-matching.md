---
name: project-qb-customer-matching
description: 2026-09-08 QBWC customer matching — an email does NOT uniquely identify a QuickBooks customer (187 shared); progress=100 ends the QBWC session; ~15 duplicate pairs deliberately left alone
type: project
---

Orders no longer auto-create a QuickBooks customer without first checking the
pulled `qb_customer_directory`. Tiers, in order: **unique** email → auto-link;
**unique** name once whitespace/case/punctuation are stripped → auto-link;
otherwise held at `qb_sync_queue.status = 'needs_review'` for an admin instead
of guessed at. Migrations `0043` + `0044`. Extends [[project-rep-price-tier-and-qbwc-plan]].

Three things here are not derivable from the code, and each one caused or
nearly caused a wrong-data bug:

**An email does NOT uniquely identify a QuickBooks customer.** 187 of the 4,874
directory emails sit on more than one record — `michaellauber007@gmail.com` on
64, `janetgarcia@ly-usa.com` on 27, `invoice.noreply@greatwolf.com` on 25.
These are buyers spanning venues, sales reps, and shared AP inboxes across
genuinely different companies. The first cut of the email tier used `limit 1`
and would have keyed sales orders to an arbitrary one of them. That is why an
exact tier must be **unique** to auto-link, and why a shared inbox falls
through to the name tier (which is usually what actually disambiguates, e.g.
25 Great Wolf locations each with its own name).

**QBWC treats progress 100 from `receiveResponseXML` as "conversation over"**
and calls `closeConnection` instead of `sendRequestXML` again. QuickBooks'
`iteratorID` is only valid inside the session that created it, so any multi-page
operation that reports 100 mid-flight strands the iterator and the next poll
dies with `The iteratorID "{...}" is not valid.` The customer pull had been
broken this way since it shipped — it only ever completed because pending
orders coincidentally held progress at 50 for all ~48 pages. It surfaced the
day the sync queue happened to be empty.

**Merging customers is a QuickBooks Desktop UI action only** — qbXML has no
merge operation, so it can never be automated from this repo. The manual path
is: rename one record to exactly match the other, accept QB's merge prompt
(single-user mode, both at the same list level). A merge retires one ListID,
which used to leave `qb_customer_links` pointing at a dead ID with nothing to
notice; a completed pull now drops those links so the match re-resolves.

**Why:** the trigger was a live duplicate — "Nation wide wholesale" got created
alongside the existing "Nationwide Wholesale" because `CustomerQueryRq` matches
on exact name and has no email filter at all.

**How to apply:** never reintroduce "one email = one customer" anywhere in the
QB path. Before touching `receiveResponseXML`'s return value, remember it is
protocol, not a UI hint. A scan found ~15 near-certain duplicate pairs in
QuickBooks (`A Dodsons`/`ADODSONS`, `NVflorist`/`NV FLORIST`,
`PALMETTO VILLE`/`PALMETTOVILLE`, …) that are **deliberately left alone** —
nothing depends on cleaning them now that duplicate names hold for review, so
don't treat them as an oversight. Also note the whole matching path is still
unexercised by a real order: verified against live data, but nothing has landed
in `needs_review` yet, so the admin panel's "Use \<match\>" / "create new"
buttons have never run for real.
