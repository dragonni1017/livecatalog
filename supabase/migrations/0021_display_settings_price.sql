-- Adds a price-visibility toggle to the existing display_settings
-- singleton, same listing/detail split as the other storefront toggles.
ALTER TABLE display_settings
  ADD COLUMN IF NOT EXISTS show_price_listing BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_price_detail   BOOLEAN NOT NULL DEFAULT true;
