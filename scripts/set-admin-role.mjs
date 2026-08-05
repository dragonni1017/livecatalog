// Usage: node scripts/set-admin-role.mjs <email>
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
// Run once per staff member to grant admin access.
//
// Example:
//   node -r dotenv/config scripts/set-admin-role.mjs admin@ly-usa.com

import { createClient } from '@supabase/supabase-js'

const [,, email] = process.argv
if (!email) {
  console.error('Usage: node scripts/set-admin-role.mjs <email>')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 })
if (listError) { console.error(listError.message); process.exit(1) }

const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
if (!user) {
  console.error(`No Supabase Auth user found with email: ${email}`)
  console.error('Create the user first in the Supabase dashboard (Authentication → Users → Add user).')
  process.exit(1)
}

const { error } = await supabase.auth.admin.updateUserById(user.id, {
  app_metadata: { role: 'admin' },
})
if (error) { console.error(error.message); process.exit(1) }

console.log(`✓ Granted admin role to ${email} (${user.id})`)
