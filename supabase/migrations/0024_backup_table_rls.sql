-- Closes a security gap: this backup snapshot table had RLS disabled,
-- making it fully readable/writable via the anon key. No app code
-- references it (only mentioned in a handoff doc) -- enabling RLS with no
-- policies matches the same service-role-only pattern already used for
-- other internal tables (import_runs, stock_adjustments, etc).
ALTER TABLE public.products_manually_hidden_backup_20260713 ENABLE ROW LEVEL SECURITY;
