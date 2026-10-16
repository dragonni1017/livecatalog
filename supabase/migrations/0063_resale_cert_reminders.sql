-- Expiry emails for resale certificates (lib/cert-reminders.ts, run by the
-- nightly /api/sync cron). Each is sent at most once per certificate; a new
-- upload is a new row, so it starts fresh.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. Existing table: no grant or policy changes.

alter table resale_certificates add column if not exists reminder_sent_at timestamptz;
alter table resale_certificates add column if not exists expired_notice_sent_at timestamptz;
