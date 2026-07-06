CREATE TABLE IF NOT EXISTS credit_applications (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name              TEXT NOT NULL,
  contact_name              TEXT NOT NULL,
  email                     TEXT NOT NULL,
  phone                     TEXT,
  address                   TEXT,
  years_in_business         TEXT,
  annual_purchase_estimate  TEXT,
  requested_terms           TEXT NOT NULL DEFAULT 'net-30'
                              CHECK (requested_terms IN ('net-30', 'net-60')),
  trade_references          TEXT,
  notes                     TEXT,
  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'denied')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE credit_applications ENABLE ROW LEVEL SECURITY;
-- No anon policies: all reads/writes go through the service-role client.

CREATE INDEX IF NOT EXISTS idx_credit_applications_status     ON credit_applications(status);
CREATE INDEX IF NOT EXISTS idx_credit_applications_created_at ON credit_applications(created_at DESC);
