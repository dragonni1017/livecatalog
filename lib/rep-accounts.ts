import type { getAdminClient } from '@/lib/supabase'
import type { RepAccount } from '@/lib/rep-attribution'

// All rep accounts (app_metadata.role = 'rep'), paging through auth users so a
// growing customer base can't push reps off the first page.
export async function loadRepAccounts(db: ReturnType<typeof getAdminClient>): Promise<RepAccount[]> {
  const reps: RepAccount[] = []
  const PER_PAGE = 1000
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) break
    const users = data?.users ?? []
    for (const u of users) {
      if (u.app_metadata?.role === 'rep' && u.email) reps.push({ id: u.id, email: u.email })
    }
    if (users.length < PER_PAGE) break
  }
  return reps.sort((a, b) => a.email.localeCompare(b.email))
}
