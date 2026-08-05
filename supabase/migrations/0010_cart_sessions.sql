CREATE TABLE cart_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  name TEXT,
  items JSONB NOT NULL DEFAULT '[]',
  reminder_sent_at TIMESTAMPTZ,
  order_placed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cart_sessions_active_email ON cart_sessions(email) WHERE order_placed_at IS NULL;
CREATE INDEX cart_sessions_updated_at ON cart_sessions(updated_at) WHERE order_placed_at IS NULL AND reminder_sent_at IS NULL;
