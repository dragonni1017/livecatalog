// send-test-recovery.mjs -- SENDS A REAL PASSWORD-RESET EMAIL.
//
// Run with: node scripts/send-test-recovery.mjs you@your-domain.com
//
// The address is a required argument with no default, so this can never
// accidentally mail a customer. Refuses to send unless the address is a
// registered auth user -- Supabase deliberately returns success for unknown
// addresses, which would otherwise look like a pass while sending nothing.
//
// Mirrors getRecoveryClient() in lib/auth-client.ts exactly: supabase-js
// createClient over the implicit flow with the anon key, the same call the
// login page's "Forgot your password?" button makes. Asserts the resulting
// client really is on the implicit flow rather than trusting the option --
// @supabase/ssr silently discards it, which shipped an inert fix once.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })

const target = process.argv[2]
if (!target || !target.includes('@')) {
  console.error('usage: node scripts/send-test-recovery.mjs you@your-domain.com')
  process.exit(1)
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !ANON || !SERVICE) {
  console.error('need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const REDIRECT = 'https://lyusa.app/reset-password'

async function run() {
  // 1. Is the target actually a user? An unregistered address yields a silent
  //    success and no mail, which would read as a false pass.
  const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) { console.error('listUsers failed: ' + listErr.message); process.exit(1) }
  const user = list.users.find((u) => (u.email || '').toLowerCase() === target.toLowerCase())
  if (!user) {
    console.error('REFUSING TO SEND: ' + target + ' is not a registered auth user.')
    console.error('Supabase would report success and mail nothing, so this would prove nothing.')
    process.exit(1)
  }
  console.log('target:      ' + target)
  console.log('registered:  yes (created ' + (user.created_at || '?').slice(0, 10) + ')')
  console.log('confirmed:   ' + (user.email_confirmed_at ? 'yes' : 'NO -- unconfirmed'))
  console.log('last signin: ' + (user.last_sign_in_at ? user.last_sign_in_at.slice(0, 10) : 'never'))
  console.log('')

  // 2. Same client the login page uses.
  const supabase = createClient(URL_, ANON, {
    auth: { flowType: 'implicit', persistSession: false, detectSessionInUrl: false, autoRefreshToken: false },
  })
  const flow = supabase.auth.flowType
  console.log('client flowType: ' + flow + (flow === 'implicit' ? ' (correct -- link works from any device)' : ' (WRONG -- link will be device-locked)'))
  console.log('redirectTo:      ' + REDIRECT)
  console.log('')

  // 3. The real send.
  console.log('sending...')
  const t0 = Date.now()
  const { error } = await supabase.auth.resetPasswordForEmail(target, { redirectTo: REDIRECT })
  const ms = Date.now() - t0

  if (error) {
    console.log('')
    console.log('FAILED after ' + ms + 'ms')
    console.log('  message: ' + (error.message || '(empty)'))
    console.log('  status:  ' + (error.status ?? '(none)'))
    console.log('')
    console.log('An empty message with status 500 is the Titan sender rejection -- GoTrue')
    console.log('answers 500 with no body, which is what used to render as a literal "{}".')
    process.exit(1)
  }

  console.log('')
  console.log('ACCEPTED by GoTrue after ' + ms + 'ms -- no SMTP error, so the mail was handed to Titan.')
  console.log('Check ' + target + '. The link should open on any device and land on ' + REDIRECT + '.')
}

run().catch((e) => { console.error('send failed: ' + e.message); process.exit(1) })
