-- 0054: filterable pack facts for the catalog's "Case size" and "Sold by"
-- filters (2026-10-02).
--
-- Neither is stored anywhere; both live in the product NAME's pack spec,
-- "<Name> - <pk>/pk <bx>bx/cs cs.<N>[unit]" (docs/PRODUCT-NAMING-STANDARD.md).
-- The catalog pages results in the database, so the filter must run in SQL,
-- not in JS after the fetch. These are GENERATED columns: Postgres
-- recomputes them whenever `name` changes, which matters because the Erply
-- sync rewrites names daily. No backfill or sync change needed.
--
-- The logic mirrors lib/product-naming.ts (parseProductName +
-- packSpecConvention). lib/catalog-filters.ts holds a TS copy that tests pin,
-- and that's checked against every product after this migration is applied.
--
-- case_pieces = pieces per pack × packs per case. Always PIECES, whichever
--   convention the name uses. (cs.N alone counts packs on a pack-sold name.)
-- sold_by     = 'piece' | 'pack', or NULL when there's no pack spec or it fits
--   neither convention. pk = 1 ('either' in TS) is 'piece': one per pack.
--
-- Tables are schema-qualified on purpose: 0053 only reached the live table
-- once written as public.order_requests.

create or replace function public.product_pack_match(n text)
returns text[]
language sql
immutable
parallel safe
as $$
  select regexp_match(
    coalesce(n, ''),
    '-\s*(\d+)\s*/pk\s+(\d+)\s*bx/cs(?:\s+cs\.(\d+)\s*(pk|bx|set|pcs|pc)?)?\s*$',
    'i'
  )
$$;

create or replace function public.product_case_pieces(n text)
returns integer
language sql
immutable
parallel safe
as $$
  select case
    when m is null then null
    else (m[1])::integer * (m[2])::integer
  end
  from (select public.product_pack_match(n) as m) s
$$;

create or replace function public.product_sold_by(n text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when m is null then null
    -- A stated unit decides it, with no fallback (packSpecConvention).
    when lower(m[4]) in ('pcs', 'pc') then
      case when cs = pk * bx then 'piece' end
    when m[4] is not null then
      case when cs = bx then 'pack' end
    -- Unstated: piece-sold if cs = pk*bx (this includes pk = 1), else
    -- pack-sold if cs = bx, else neither.
    when cs = pk * bx then 'piece'
    when cs = bx then 'pack'
  end
  from (
    select m,
           (m[1])::integer as pk,
           (m[2])::integer as bx,
           coalesce((m[3])::integer, (m[1])::integer * (m[2])::integer) as cs
    from (select public.product_pack_match(n) as m) s0
  ) s
$$;

alter table public.products
  add column if not exists case_pieces integer
    generated always as (public.product_case_pieces(name)) stored,
  add column if not exists sold_by text
    generated always as (public.product_sold_by(name)) stored;

create index if not exists idx_products_case_pieces on public.products(case_pieces);
create index if not exists idx_products_sold_by on public.products(sold_by);

notify pgrst, 'reload schema';
