-- Optional cover image for a collection, shown on the homepage collection
-- strip. Without one, the strip shows a mosaic of the collection's first
-- product photos. Uploaded through the existing admin image uploader (the
-- public product-images bucket), so this is just a URL.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. Existing table: no grant or policy changes.

alter table collections add column if not exists cover_image_url text
  check (cover_image_url is null or (cover_image_url ~ '^https://' and char_length(cover_image_url) <= 1000));
