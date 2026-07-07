-- Lets admin set what unit a product's price_cents is quoted per, so the
-- admin product editor can show/edit "per pc / per case / per box / per pack"
-- alongside price. Purely an admin-facing label — not shown to customers.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS unit_type TEXT NOT NULL DEFAULT 'pc'
    CHECK (unit_type IN ('pc', 'case', 'box', 'pack'));
