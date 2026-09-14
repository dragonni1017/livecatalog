// probe-recovery-redirect.mjs -- is the recovery redirect actually allow-listed?
//
// Run with: node scripts/probe-recovery-redirect.mjs
//           node scripts/probe-recovery-redirect.mjs user@example.com
//
// SENDS NO EMAIL. admin.generateLink mints a recovery link server-side without
// mailing it, and GoTrue reports the redirect it actually intends to use -- so
// an unlisted URL shows up as the Site URL substituted in its place, which is
// the silent failure that killed password reset until 2026-09-09 (see
// docs/memory/project-auth-redirect-allowlist.md).
//
// Probes the real reset URL plus a deliberately-blocked preview URL as a
// negative control, so a pass proves the probe can actually detect a failure.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const CANDIDATES = [
  { url: 'https://lyusa.app/reset-password', expect: 'allowed' },
  // Blocked on purpose as of 2026-09-09 -- if this one comes back "allowed",
  // the allow-list is wider than intended.
  { url: 'https://livecatalog.vercel.app/reset-password', expect: 'blocked' },
]

async function pickUser(arg) {
  if (arg) return arg
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 100 })
  if (error) throw new Error('listUsers failed: ' + error.message)
  // Prefer a confirmed account -- recovery for an unconfirmed one can behave
  // differently and would muddy the redirect signal we are after.
  const confirmed = data.users.filter((u) => u.email && u.email_confirmed_at)
  if (!confirmed.length) throw new Error('no confirmed users found to probe with')
  return confirmed[0].email
}

const mask = (e) => {
  const [name, domain] = e.split('@')
  return (name.length <= 2 ? name[0] + '*' : name.slice(0, 2) + '*'.repeat(name.length - 2)) + '@' + domain
}

async function run() {
  const email = await pickUser(process.argv[2])
  console.log('probing with ' + mask(email) + ' (no mail is sent)')
  console.log('')

  let failures = 0
  for (const { url, expect } of CANDIDATES) {
    const { data, error } = await db.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: url },
    })
    if (error) {
      console.log('ERROR  ' + url)
      console.log('       ' + error.message)
      failures++
      continue
    }
    const actual = data.properties?.redirect_to ?? '(none returned)'
    const allowed = actual === url
    const verdict = allowed ? 'allowed' : 'SUBSTITUTED'
    const asExpected = (allowed ? 'allowed' : 'blocked') === expect
    console.log((asExpected ? 'ok   ' : 'WRONG') + '  ' + url)
    console.log('       requested: ' + url)
    console.log('       GoTrue:    ' + actual + '   -> ' + verdict)
    console.log('       expected:  ' + expect)
    if (!asExpected) failures++
  }

  console.log('')
  console.log(failures === 0
    ? 'PASS -- the reset URL is allow-listed and the blocked preview URL is still blocked.'
    : 'FAIL -- ' + failures + ' candidate(s) did not behave as expected.')
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => { console.error('probe failed: ' + e.message); process.exit(1) })
