const BASE = 'http://localhost:3000'
const EMAIL = 'dragon@ly-usa.com'
const PASSWORD = process.env.ADMIN_PASSWORD ?? ''

async function post(body) {
  const r = await fetch(`${BASE}/api/admin/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await r.text().catch(() => '')
  return { status: r.status, body: text }
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  return { status: r.status, location: r.headers.get('location') }
}

// 1. Login page has email + password fields
const page = await fetch(`${BASE}/admin/login`).then(r => r.text())
const hasEmail = page.includes('type="email"')
const hasPassword = page.includes('type="password"')
console.log(`[1] Login page - email field: ${hasEmail}, password field: ${hasPassword}`)

// 2. Wrong password returns 401
const r1 = await post({ email: EMAIL, password: 'wrongpassword', totp: '' })
console.log(`[2] Wrong password -> ${r1.status}: ${r1.body}`)

// 3. Wrong email (non-admin user) returns 401
const r2 = await post({ email: 'notadmin@example.com', password: PASSWORD, totp: '' })
console.log(`[3] Non-admin email -> ${r2.status}: ${r2.body}`)

// 4. Correct credentials return 200
const r3 = await post({ email: EMAIL, password: PASSWORD, totp: '' })
console.log(`[4] Correct credentials -> ${r3.status}: ${r3.body}`)

// 5. Unauthenticated /admin redirects to /admin/login
const r4 = await get('/admin')
console.log(`[5] Unauthed /admin -> ${r4.status}, redirect to: ${r4.location}`)

console.log('\n' + (
  hasEmail && hasPassword && r1.status === 401 && r3.status === 200 && r4.status === 307
    ? '✓ All checks passed'
    : '✗ Some checks failed'
))
