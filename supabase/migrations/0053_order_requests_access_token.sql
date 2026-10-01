-- 0053: per-order secret for the public order page (/order/<reference>).
--
-- Reference codes are sequential (ORD-<year>[-TIER]-NNNN), and the order page
-- and /api/order-reply used to accept the reference alone. Anyone could walk
-- the sequence and read a customer's name, line items and prices, or message
-- sales as that customer. (2026-10-01 /api audit; see
-- docs/memory/project-api-route-auth-audit-20261001.md.)
--
-- Access now requires ONE of: ?t=<access_token> in the link (customer emails
-- carry it), a signed-in session whose email matches the order, an admin, or
-- the rep who placed it. See lib/order-access.ts.
--
-- gen_random_uuid() is volatile, so ADD COLUMN evaluates it per row: every
-- existing order gets its own token. Links emailed before this migration
-- carry no token. Dragon decided those require sign-in, and the next status
-- email carries a working link.
--
-- No grants needed: an existing table, and order_requests has RLS on with no
-- public policy (0001), so the anon key can't read the column.

alter table order_requests
  add column if not exists access_token text not null
    default replace(gen_random_uuid()::text, '-', '');

create unique index if not exists idx_order_requests_access_token
  on order_requests(access_token);
