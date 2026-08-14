-- adjust_stock and submit_order are SECURITY DEFINER (run with the table
-- owner's privileges, bypassing RLS) and are only ever called server-side
-- via lib/supabase.ts's getAdminClient() (service-role key) -- see
-- app/api/orders/route.ts and app/admin/api/stock/{,bulk/}route.ts.
-- Postgres grants EXECUTE to PUBLIC on new functions by default, and
-- Supabase additionally auto-grants EXECUTE directly to anon/authenticated
-- on every new public-schema function (confirmed live via pg_proc.proacl --
-- revoking from PUBLIC alone did not remove those). Both were callable
-- directly by anyone holding the public anon key via
-- POST /rest/v1/rpc/{adjust_stock,submit_order}, bypassing this app's own
-- input validation entirely. Locks EXECUTE to service_role only, and pins
-- search_path (was mutable, a classic SECURITY DEFINER hijack vector) to a
-- fixed value that still resolves their unqualified table references.

revoke execute on function public.adjust_stock(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.adjust_stock(text, integer, text, text) to service_role;
alter function public.adjust_stock(text, integer, text, text) set search_path = public, pg_temp;

revoke execute on function public.submit_order(text, text, text, text, text, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_order(text, text, text, text, text, text, integer, text, text, jsonb) to service_role;
alter function public.submit_order(text, text, text, text, text, text, integer, text, text, jsonb) set search_path = public, pg_temp;
