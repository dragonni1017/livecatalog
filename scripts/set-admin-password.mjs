// Usage: node --env-file=.env.local scripts/set-admin-password.mjs <email>
// Sets the Supabase Auth password for an admin user to ADMIN_PASSWORD from .env.local.
// Run once after migrating from the old cookie-based admin auth.

import { createClient } from '@supabase/supabase-js'

const [,, email] = process.argv
if (!email) {
  console.error('Usage: node --env-file=.env.local scripts/set-admin-password.mjs <email>')
  process.exit(1)
}

const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey, ADMIN_PASSWORD: password } = process.env
if (!url || !serviceKey || !password) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or ADMIN_PASSWORD')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 })
if (listError) { console.error(listError.message); process.exit(1) }

const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
if (!user) { console.error(`No user found: ${email}`); process.exit(1) }

const { error } = await supabase.auth.admin.updateUserById(user.id, { password })
if (error) { console.error(error.message); process.exit(1) }

console.log(`✓ Password updated for ${email} — now matches ADMIN_PASSWORD`)
