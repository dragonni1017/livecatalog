-- Quote form funnel events (/api/track, lib/quote-form-events.ts).
--
-- Two more analytics_events types, so /admin/analytics can show where
-- buyers stop between opening the quote and submitting it:
--   quote_form_started   first time a visitor clicks into the quote form
--   quote_submit_blocked Submit was refused; source = the reason
--                        (missing_email, missing_zip, ...)
-- Only the type check changes; no new columns (source exists since 0062).
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project
-- aguorduaxfqrvvywgrdi) and run once. Until it runs, the two new events
-- are refused by the check and dropped (logged, never shown to buyers).

alter table analytics_events drop constraint if exists analytics_events_type_check;
alter table analytics_events add constraint analytics_events_type_check
  check (type in (
    'view', 'search', 'add_to_cart', 'cart_view', 'quote_submitted',
    'quote_form_started', 'quote_submit_blocked'
  ));
