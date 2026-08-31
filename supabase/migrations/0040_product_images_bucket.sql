-- Supabase Storage bucket for admin-uploaded product images -- lets admin
-- attach a file directly instead of only pasting an already-hosted URL
-- (app/admin/api/products/upload-image + ImageUploadField.tsx). Public
-- bucket: these are the same product photos already served directly to any
-- storefront visitor via products.image_url, no different in sensitivity.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project
-- aguorduaxfqrvvywgrdi) and run once. No migration runner in this project.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Public read -- explicit policy mirroring this project's convention for
-- anything the public catalog needs to read (see products/categories
-- policies), even though a public bucket already serves objects via its own
-- unauthenticated /object/public/ path regardless of this policy.
create policy "Public can read product-images"
on storage.objects for select
to public
using (bucket_id = 'product-images');

-- No insert/update/delete policy on purpose -- uploads only ever happen via
-- a signed upload URL minted by app/admin/api/products/upload-image (using
-- the service-role client, which bypasses RLS entirely), same
-- service-role-only convention as qb_sync_queue etc. (migration 0031).
