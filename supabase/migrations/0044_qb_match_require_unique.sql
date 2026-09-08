-- 0043's email tier assumed an email identifies one customer ("two real
-- companies essentially never share an address"). The live directory says
-- otherwise: of 4,874 customers, 187 emails are on more than one record --
-- michaellauber007@gmail.com on 64, janetgarcia@ly-usa.com on 27,
-- invoice.noreply@greatwolf.com on 25. Those are buyers, reps and shared AP
-- inboxes spanning genuinely different companies, not duplicates.
--
-- With `limit 1` that auto-linked an order to an arbitrary one of them and
-- keyed the sales order to the wrong customer -- a worse failure than the
-- duplicate-creation this all exists to prevent, because it is silent and
-- lands real money on the wrong account.
--
-- So an exact tier now has to be UNIQUE to auto-link. A non-unique email
-- falls through to the name tier, which is usually exactly what
-- disambiguates a shared AP inbox (25 Great Wolf locations, one matching
-- name). Anything still unresolved is held for review rather than guessed
-- at -- including "email matched several, name matched none", where
-- creating a new customer under a shared inbox is the likely wrong move.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

-- How many customers the held candidate was drawn from, so the review panel
-- can say "3 customers share this" instead of implying a single near-miss.
alter table qb_sync_queue add column if not exists match_candidate_count integer;

-- Return signature gains a column, so replace rather than create-or-replace.
drop function if exists qb_match_customer(text, text);

create function qb_match_customer(p_email text, p_name text)
returns table (tier text, qb_customer_list_id text, matched_name text, score real, candidate_count integer)
language plpgsql
stable
as $$
declare
  v_norm_name text := lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_fuzzy_floor constant real := 0.55;
  v_email_matches integer := 0;
  v_name_matches integer := 0;
begin
  if p_email is not null and btrim(p_email) <> '' then
    select count(*) into v_email_matches
    from qb_customer_directory d
    where lower(d.email) = lower(btrim(p_email));

    if v_email_matches = 1 then
      return query
        select 'email'::text, d.qb_customer_list_id, d.full_name, 1.0::real, 1
        from qb_customer_directory d
        where lower(d.email) = lower(btrim(p_email));
      return;
    end if;
  end if;

  if v_norm_name <> '' then
    select count(*) into v_name_matches
    from qb_customer_directory d
    where lower(regexp_replace(d.full_name, '[^a-zA-Z0-9]', '', 'g')) = v_norm_name
       or (d.company_name is not null
           and lower(regexp_replace(d.company_name, '[^a-zA-Z0-9]', '', 'g')) = v_norm_name);

    if v_name_matches = 1 then
      return query
        select 'name'::text, d.qb_customer_list_id, d.full_name, 1.0::real, 1
        from qb_customer_directory d
        where lower(regexp_replace(d.full_name, '[^a-zA-Z0-9]', '', 'g')) = v_norm_name
           or (d.company_name is not null
               and lower(regexp_replace(d.company_name, '[^a-zA-Z0-9]', '', 'g')) = v_norm_name);
      return;
    end if;

    -- Several customers filed under the same name: a coin flip between real
    -- duplicates, or between distinct locations sharing a name. Either way
    -- not ours to pick.
    if v_name_matches > 1 then
      return query
        select 'ambiguous'::text, d.qb_customer_list_id, d.full_name, 1.0::real, v_name_matches
        from qb_customer_directory d
        where lower(regexp_replace(d.full_name, '[^a-zA-Z0-9]', '', 'g')) = v_norm_name
           or (d.company_name is not null
               and lower(regexp_replace(d.company_name, '[^a-zA-Z0-9]', '', 'g')) = v_norm_name)
        order by d.full_name
        limit 1;
      return;
    end if;
  end if;

  -- Shared inbox, and the name resolved nothing. Creating a new customer here
  -- is how you get a duplicate filed under someone else's AP address.
  if v_email_matches > 1 then
    return query
      select 'ambiguous'::text, d.qb_customer_list_id, d.full_name, 1.0::real, v_email_matches
      from qb_customer_directory d
      where lower(d.email) = lower(btrim(p_email))
      order by d.full_name
      limit 1;
    return;
  end if;

  if v_norm_name = '' then
    return;
  end if;

  -- See 0043 for why the floor is explicit and compared directly rather than
  -- left to pg_trgm's 0.3 default.
  return query
    select * from (
      select 'fuzzy'::text as tier, d.qb_customer_list_id, d.full_name as matched_name,
        greatest(
          similarity(v_norm_name, lower(regexp_replace(d.full_name, '[^a-zA-Z0-9]', '', 'g'))),
          coalesce(similarity(v_norm_name, lower(regexp_replace(d.company_name, '[^a-zA-Z0-9]', '', 'g'))), 0)
        )::real as score,
        1 as candidate_count
      from qb_customer_directory d
    ) scored
    where scored.score >= v_fuzzy_floor
    order by scored.score desc
    limit 1;
end;
$$;
