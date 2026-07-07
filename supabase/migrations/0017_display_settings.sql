-- Singleton row of site-wide storefront display toggles, controlled from
-- /admin/display-settings. No RLS (matches products/categories) — the public
-- catalog reads this with the anon client to decide what to render.
CREATE TABLE IF NOT EXISTS display_settings (
  id                        INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  show_stock_listing        BOOLEAN NOT NULL DEFAULT true,
  show_stock_detail         BOOLEAN NOT NULL DEFAULT true,
  show_sku_barcode_listing  BOOLEAN NOT NULL DEFAULT true,
  show_sku_barcode_detail   BOOLEAN NOT NULL DEFAULT true,
  show_category_listing     BOOLEAN NOT NULL DEFAULT true,
  show_category_detail      BOOLEAN NOT NULL DEFAULT true,
  show_pack_info_listing    BOOLEAN NOT NULL DEFAULT true,
  show_pack_info_detail     BOOLEAN NOT NULL DEFAULT true,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO display_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
