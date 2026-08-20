import { getAdminClient } from '@/lib/supabase'
import RepAccountsTable from '@/components/admin/RepAccountsTable'

export const dynamic = 'force-dynamic'

// Rep accounts are Supabase Auth users with app_metadata.role='rep' (same
// manual-provisioning model as admin) -- no separate `reps` table. This is
// the admin UI for listing/creating/deactivating them; see
// app/admin/api/rep-accounts/route.ts for the mutations.
//
// Named /admin/rep-accounts (not /admin/reps) because /admin/reps already
// exists as a rep-performance analytics page keyed off the free-text
// placed_by_rep field on orders -- a different concept from these real
// login accounts.
export default async function RepAccountsPage() {
  const db = getAdminClient()
  const { data, error } = await db.auth.admin.listUsers({ perPage: 200 })
  const reps = error
    ? []
    : (data?.users ?? [])
        .filter((u) => u.app_metadata?.role === 'rep')
        .map((u) => ({
          id: u.id,
          email: u.email ?? '',
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          banned_until: u.banned_until ?? null,
        }))
        .sort((a, b) => a.email.localeCompare(b.email))

  return <RepAccountsTable initialReps={reps} loadError={Boolean(error)} />
}
