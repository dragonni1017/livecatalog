ALTER TABLE products ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN products.image_urls IS 'Additional product image URLs (beyond the primary image_url)';
