-- Volume pricing tiers per product.
-- Format: [{"min_qty": 12, "price_cents": 900}, {"min_qty": 24, "price_cents": 800}]
-- Null means standard pricing only. Tiers are sorted by min_qty at read time.
ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_tiers JSONB DEFAULT NULL;
