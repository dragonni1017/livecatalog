-- Order follow-up, part 1 (docs/ORDER-FOLLOW-UP-PLAN.md).
--
-- Adds the columns the whole plan needs, so later parts need no migration:
--  - assigned_at: when assigned_rep_email (unused since 0001) was set. PR 2.
--  - first_response_at: the first time an order left 'new'. Stamped from
--    PR 3 on; backfilled here from status_changed_at for orders already
--    past 'new' (the best record there is of when that happened).
--  - dismissed_at / dismissed_reason / dismissed_by: a SILENT way to take a
--    test, duplicate or spam request out of the "waiting" counts. Unlike
--    marking it 'lost', it sends the customer no email, touches no stock and
--    never reaches QuickBooks. Set only while the order is 'new'
--    (app/admin/api/orders/dismiss/route.ts); undo clears all three.
--
-- New columns on an existing table inherit its grants, so no grant
-- statements are needed (CLAUDE.md, the bins/bin_types trap).
alter table order_requests
  add column if not exists assigned_at       timestamptz,
  add column if not exists first_response_at timestamptz,
  add column if not exists dismissed_at      timestamptz,
  add column if not exists dismissed_reason  text,
  add column if not exists dismissed_by      text;

-- The reason is one of three values, and it is set exactly when dismissed_at is.
alter table order_requests drop constraint if exists order_requests_dismissed_reason_check;
alter table order_requests add constraint order_requests_dismissed_reason_check
  check (dismissed_reason is null or dismissed_reason in ('test', 'duplicate', 'spam'));
alter table order_requests drop constraint if exists order_requests_dismissed_pair_check;
alter table order_requests add constraint order_requests_dismissed_pair_check
  check ((dismissed_at is null) = (dismissed_reason is null));

update order_requests
   set first_response_at = status_changed_at
 where status <> 'new'
   and first_response_at is null
   and status_changed_at is not null;

comment on column order_requests.assigned_at is
  'When assigned_rep_email was last set (order follow-up plan, part 2).';
comment on column order_requests.first_response_at is
  'First time the order left status new. Backfilled from status_changed_at by 0069.';
comment on column order_requests.dismissed_at is
  'Set when an admin silently dismissed a new order (test/duplicate/spam). No email, stock or QuickBooks effect. Null = not dismissed.';
comment on column order_requests.dismissed_reason is
  'test | duplicate | spam. Set exactly when dismissed_at is.';
comment on column order_requests.dismissed_by is
  'Who dismissed it (the shared admin login records "admin").';
