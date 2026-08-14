-- Flags products with no image in any known source (Erply, WooCommerce,
-- Cloudinary/Supabase, or the GoDaddy archive) as needing new photography.
-- Populated by scripts/find-truly-missing-images.mjs's output; see
-- scripts/mark-needs-photo.mjs for the script that sets it.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS needs_photo BOOLEAN NOT NULL DEFAULT false;
