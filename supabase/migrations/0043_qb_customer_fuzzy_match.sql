-- Auto-sync currently only checks an explicit qb_customer_links row, then
-- falls straight to QuickBooks' own CustomerQueryRq (exact name, no email
-- filter) before auto-creating -- so a customer that already exists in
-- QuickBooks under slightly different spacing/casing (or even a real
-- misspelling) gets a duplicate created instead of matched. This wires the
-- already-pulled qb_customer_directory (migration 0035) into that decision
-- via a tiered match: exact email, then exact name once whitespace/case/
-- punctuation are stripped from both sides (safe to auto-link either way),
-- then a fuzzy trigram candidate (too risky to auto-link -- held for admin
-- review instead, see app/api/qbwc/route.ts and
-- app/admin/api/qbwc/sync-errors/route.ts).
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

-- 'needs_review' is a held state distinct from 'error': nothing failed,
-- there's just a candidate match too uncertain to auto-attach. Columns hold
-- that candidate so the admin panel can show it without a second lookup.
-- skip_fuzzy_match lets an admin say "not a match, create new" on retry
-- without the same fuzzy candidate holding it again.
alter table qb_sync_queue drop constraint qb_sync_queue_status_check;
alter table qb_sync_queue add constraint qb_sync_queue_status_check
  check (status in ('pending','sent','acked','error','needs_review'));
alter table qb_sync_queue add column if not exists match_candidate_qb_list_id text;
alter table qb_sync_queue add column if not exists match_candidate_name text;
alter table qb_sync_queue add column if not exists match_candidate_score real;
alter table qb_sync_queue add column if not exists skip_fuzzy_match boolean not null default false;

-- Distinguishes a link this migration's tier-1/2 auto-match created from a
-- true live QuickBooks lookup ('qbwc_pull') or an admin's manual pick
-- ('manual') -- shown on the Link Customers admin page.
alter table qb_customer_links drop constraint qb_customer_links_last_sync_source_check;
alter table qb_customer_links add constraint qb_customer_links_last_sync_source_check
  check (last_sync_source in ('qbwc_pull','manual','directory_match'));

-- Returns at most one row: the best match for (p_email, p_name) against the
-- pulled QuickBooks customer list, tiered by confidence. 'email' and 'name'
-- tiers are exact (post-normalization) and safe to auto-link; 'fuzzy' is a
-- trigram-similarity candidate the caller must NOT auto-link.
--
-- The fuzzy floor is deliberately well above pg_trgm's 0.3 default, and is
-- compared explicitly rather than via the `%` operator so it can't drift with
-- the session's pg_trgm.similarity_threshold GUC. Measured against the live
-- 4,829-row directory: "Nation wide wholesale" (a customer genuinely absent
-- from the list) scored 0.37 against the unrelated "Sabi Auction Wholesale"
-- purely on the shared word, while a real one-letter typo of a name that IS
-- present scored 0.71 -- so 0.55 separates "plausible typo, ask a human" from
-- "noise, just create it" with room on both sides.
create or replace function qb_match_customer(p_email text, p_name text)
returns table (tier text, qb_customer_list_id text, matched_name text, score real)
language plpgsql
stable
as $$
declare
  v_norm_name text := lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_fuzzy_floor constant real := 0.55;
begin
  if p_email is not null and btrim(p_email) <> '' then
    return query
      select 'email'::text, d.qb_customer_list_id, d.full_name, 1.0::real
      from qb_customer_directory d
      where lower(d.email) = lower(btrim(p_email))
      limit 1;
    if found then return; end if;
  end if;

  if v_norm_name = '' then
    return;
  end if;

  return query
    select 'name'::text, d.qb_customer_list_id, d.full_name, 1.0::real
    from qb_customer_directory d
    where lower(regexp_replace(d.full_name, '[^a-zA-Z0-9]', '', 'g')) = v_norm_name
       or (d.company_name is not null
           and lower(regexp_replace(d.company_name, '[^a-zA-Z0-9]', '', 'g')) = v_norm_name)
    limit 1;
  if found then return; end if;

  return query
    select * from (
      select 'fuzzy'::text as tier, d.qb_customer_list_id, d.full_name as matched_name,
        greatest(
          similarity(v_norm_name, lower(regexp_replace(d.full_name, '[^a-zA-Z0-9]', '', 'g'))),
          coalesce(similarity(v_norm_name, lower(regexp_replace(d.company_name, '[^a-zA-Z0-9]', '', 'g'))), 0)
        )::real as score
      from qb_customer_directory d
    ) scored
    where scored.score >= v_fuzzy_floor
    order by scored.score desc
    limit 1;
end;
$$;
