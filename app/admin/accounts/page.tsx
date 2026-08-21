import { getAdminClient } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth-server'
import AccountsTable from '@/components/admin/AccountsTable'

export const dynamic = 'force-dynamic'

// Staff login accounts (admin + rep) are Supabase Auth users with
// app_metadata.role set manually (no separate `admins`/`reps` table). This
// is the admin UI for listing/creating/editing/deactivating them; see
// app/admin/api/accounts/route.ts for the mutations.
//
// Previously this page only listed role==='rep' accounts (as
// /admin/rep-accounts) — it now covers both roles so admin accounts can be
// managed (and reps promoted) from one place.
const KNOWN_ROLES = new Set(['admin', 'rep'])

export default async function AccountsPage() {
  const [db, sessionUser] = [getAdminClient(), await getSessionUser()]
  const { data, error } = await db.auth.admin.listUsers({ perPage: 200 })
  const accounts = error
    ? []
    : (data?.users ?? [])
        .filter((u) => KNOWN_ROLES.has(u.app_metadata?.role))
        .map((u) => ({
          id: u.id,
          email: u.email ?? '',
          role: u.app_metadata?.role as 'admin' | 'rep',
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          banned_until: u.banned_until ?? null,
        }))
        .sort((a, b) => a.email.localeCompare(b.email))

  return (
    <AccountsTable initialAccounts={accounts} loadError={Boolean(error)} currentUserId={sessionUser?.id ?? null} />
  )
}
