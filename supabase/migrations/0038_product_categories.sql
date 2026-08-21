-- HOW TO APPLY: paste into the Supabase SQL editor and run. Not applied via CLI.
--
-- Adds real many-to-many category support. Until now a product had exactly
-- one category (products.category_id, a single FK) -- this adds a join
-- table so a product can belong to any number of categories, while leaving
-- products.category_id in place and working exactly as before ("primary"
-- category) so nothing that already reads/writes it breaks:
--   - lib/erply.ts / lib/product-sync.ts (Erply sync) only ever sets
--     category_id on INSERT for a brand-new product, never on update.
--   - app/api/import/route.ts (Excel import) sets category_id the same way.
--   - Both keep working completely unchanged.
--
-- The trigger below mirrors category_id into product_categories on INSERT
-- only (not UPDATE) -- so a newly-synced/imported product's primary
-- category automatically becomes browsable via the join table with zero
-- app-code changes in those pipelines. UPDATE is deliberately not covered
-- by the trigger: the admin product-edit UI is being changed to own a
-- product's *full* category set directly (replacing all product_categories
-- rows for that product on save, and setting category_id to the first of
-- the selected categories) -- auto-mirroring on every category_id update
-- too would fight with that and leave stale rows behind when an admin
-- removes a product's primary category rather than just adding to it.

create table if not exists product_categories (
  product_id text not null references products(id) on delete cascade,
  category_id text not null references categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, category_id)
);

alter table product_categories enable row level security;

create index if not exists product_categories_category_id_idx on product_categories(category_id);

-- Backfill: every product's existing single category becomes its first
-- (and today, only) row in the join table.
insert into product_categories (product_id, category_id)
select id, category_id from products where category_id is not null
on conflict (product_id, category_id) do nothing;

create or replace function sync_primary_category_to_product_categories()
returns trigger as $$
begin
  if new.category_id is not null then
    insert into product_categories (product_id, category_id)
    values (new.id, new.category_id)
    on conflict (product_id, category_id) do nothing;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_primary_category_on_insert on products;
create trigger trg_sync_primary_category_on_insert
after insert on products
for each row
execute function sync_primary_category_to_product_categories();
