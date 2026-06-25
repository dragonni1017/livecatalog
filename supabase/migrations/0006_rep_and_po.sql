-- Rep attribution + customer PO number on order requests.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- placed_by_rep: which sales rep submitted the order (free text or from a
-- per-rep ?rep= link). po_number: the customer's own purchase-order reference,
-- carried onto the printable sales order and into QuickBooks.

alter table order_requests
  add column if not exists placed_by_rep text,
  add column if not exists po_number     text;
