ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER;
COMMENT ON COLUMN products.low_stock_threshold IS 'Override for low-stock alert threshold. NULL = use global default.';
