import { getAdminClient } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth-server'
import UsersTable, { UserAccount } from '@/components/admin/UsersTable'
import type { User } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const KNOWN_ROLES = new Set(['rep', 'admin'])

function toUserAccount(u: User): UserAccount {
  const role = u.app_metadata?.role
  return {
    id: u.id,
    email: u.email ?? '',
    role: KNOWN_ROLES.has(role) ? (role as 'rep' | 'admin') : 'customer',
    name: u.user_metadata?.name ?? null,
    company: u.user_metadata?.company ?? null,
    emailConfirmed: Boolean(u.email_confirmed_at),
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    bannedUntil: u.banned_until ?? null,
  }
}

// listUsers paginates server-side (perPage caps at 1000, but we page at 200
// to match the pre-existing behavior) — a single call assumes there's only
// ever one page, which silently truncated the list once the account count
// passed perPage. Loop until a page comes back short.
async function listAllUsers(): Promise<{ users: User[]; error: boolean }> {
  const db = getAdminClient()
  const perPage = 200
  let page = 1
  const users: User[] = []

  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage })
    if (error) return { users, error: true }
    const batch = data?.users ?? []
    users.push(...batch)
    if (batch.length < perPage) break
    page += 1
  }

  return { users, error: false }
}

export default async function AdminUsersPage() {
  const [{ users, error }, sessionUser] = await Promise.all([listAllUsers(), getSessionUser()])
  const accounts = users.map(toUserAccount).sort((a, b) => a.email.localeCompare(b.email))

  return <UsersTable initialAccounts={accounts} loadError={error} currentUserId={sessionUser?.id ?? null} />
}
