-- Records the outcome of a net-terms (credit) application review, so
-- /admin/credit-applications can actually approve or decline one instead of
-- being a read-only list. Migration 0015 created the table with a
-- status CHECK of ('pending','approved','denied') but no columns for who
-- decided, when, on what terms, or why -- the decision itself had nowhere to
-- live, so nothing in the app ever moved a row off 'pending'.
--
-- approved_terms is separate from requested_terms on purpose: approving an
-- applicant for shorter terms than they asked for (net-30 when they wanted
-- net-60) is a normal outcome, and overwriting requested_terms would lose
-- what they actually applied for. Same CHECK values as requested_terms.
--
-- A decision is reversible (unlike order approval, which keys into
-- QuickBooks): status can go back to 'pending', which clears these columns.
-- Nothing downstream consumes the approval yet -- customers.price_tier_code /
-- discount_percent stay the pricing path, and QuickBooks terms are still set
-- by hand when the customer is keyed in.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

alter table credit_applications
  add column if not exists reviewed_at    timestamptz,
  add column if not exists reviewed_by    text,
  add column if not exists review_notes   text,
  add column if not exists approved_terms text;

do $$
begin
  alter table credit_applications
    add constraint credit_applications_approved_terms_check
    check (approved_terms is null or approved_terms in ('net-30', 'net-60'));
exception
  when duplicate_object then null;
end $$;
