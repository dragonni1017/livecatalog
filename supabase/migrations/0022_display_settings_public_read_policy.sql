-- display_settings has RLS enabled (confirmed live 2026-08-14) but had
-- zero policies -- unlike products/categories, which have RLS + an
-- explicit public-SELECT policy. With no policy, every anon read of this
-- table silently returns 0 rows, so lib/display-settings.ts's
-- getDisplaySettings() has been falling back to DEFAULT_DISPLAY_SETTINGS
-- (all true) for every real site visitor since this table shipped in
-- migration 0017 -- every toggle on /admin/display-settings has been a
-- no-op on the live storefront, not just the new price one added here.
CREATE POLICY "Public can read display_settings" ON display_settings
  FOR SELECT
  TO public
  USING (true);
