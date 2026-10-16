// Live end-to-end checks for the signed-in customer and rep features:
// resale certificates, the ship-to address book, the line card and funnel
// tracking. Kept version of the throwaway checks run when each shipped
// (2026-10-16).
//
// RUNS AGAINST THE REAL SUPABASE PROJECT in .env.local. It creates throwaway
// confirmed users (e2etest-*@example.com), drives the routes on a running dev
// server with real session cookies, and deletes everything it created. It
// never runs in CI.
//
//   1. npx next dev -p 3456          (in another terminal)
//   2. E2E_LIVE=1 npm run test:e2e   (E2E_BASE_URL defaults to http://localhost:3456)
//
// Exits 1 on any failure. A crashed earlier run's leftovers are swept at start.

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { readFileSync } from 'node:fs'

if (process.env.E2E_LIVE !== '1') {
  console.error('Refusing to run: this test writes to the LIVE Supabase project. Set E2E_LIVE=1 to confirm.')
  process.exit(2)
}

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !ANON || !SECRET) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(2)
}
const HOST = (process.env.E2E_BASE_URL ?? 'http://localhost:3456').replace(/\/$/, '')
const admin = createClient(URL_, SECRET)
const anon = createClient(URL_, ANON)
const BUCKET = 'resale-certificates'
const PREFIX = 'e2etest-'
const stamp = Date.now()
const password = `T!${crypto.randomUUID()}`
const visitorId = `${PREFIX}${crypto.randomUUID()}`.slice(0, 64)

let failures = 0
const section = (name) => console.log(`\n${name}`)
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra ? '  -> ' + extra : ''}`)
}
// Count HTML attributes only: the RSC payload repeats className strings.
const count = (html, s) => html.split(s).length - 1

async function cleanupUser(id) {
  const { data: objs } = await admin.storage.from(BUCKET).list(id)
  if (objs?.length) await admin.storage.from(BUCKET).remove(objs.map((o) => `${id}/${o.name}`))
  await admin.from('resale_certificates').delete().eq('user_id', id)
  await admin.from('customer_addresses').delete().eq('user_id', id)
  await admin.auth.admin.deleteUser(id)
}

async function cleanupCustomerProfiles() {
  await admin.from('customers').delete().like('email', `${PREFIX}%@example.com`)
}

async function sweepLeftovers() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const stale = (data?.users ?? []).filter((u) => u.email?.startsWith(PREFIX) && u.email.endsWith('@example.com'))
  for (const u of stale) await cleanupUser(u.id)
  await cleanupCustomerProfiles()
  await admin.from('analytics_events').delete().like('visitor_id', `${PREFIX}%`)
  return stale.length
}

const users = []
async function signIn(label, appMeta = {}) {
  const email = `${PREFIX}${label}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMeta })
  if (error) throw error
  users.push(data.user.id)
  const jar = new Map()
  const ssr = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)),
    },
  })
  const { error: se } = await ssr.auth.signInWithPassword({ email, password })
  if (se) throw se
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ')
  const call = async (method, path, body) => {
    const res = await fetch(HOST + path, {
      method,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text, location: res.headers.get('location') }
  }
  return { id: data.user.id, email, call }
}

try {
  try {
    await fetch(HOST, { method: 'HEAD' })
  } catch {
    console.error(`No server at ${HOST}. Start one with: npx next dev -p 3456`)
    process.exit(2)
  }
  const swept = await sweepLeftovers()
  if (swept) console.log(`(swept ${swept} leftover test user(s) from an earlier run)`)

  const a = await signIn('a')
  const b = await signIn('b')

  // ── Resale certificates ──────────────────────────────────────────────────
  section('Resale certificates')
  let r = await fetch(`${HOST}/api/account/resale-certificate`)
  check('GET without session is 401', r.status === 401, `got ${r.status}`)
  let x = await a.call('POST', '/api/account/resale-certificate', { action: 'prepare', filename: 'Seller Permit.pdf' })
  const prep = x.json
  check('prepare gives a path in the caller\'s folder', x.status === 200 && prep?.path?.startsWith(`${a.id}/`), JSON.stringify(x.json))
  x = await a.call('POST', '/api/account/resale-certificate', { action: 'save', path: prep.path, state: 'CA', permitNumber: '1' })
  check('save before the upload finishes is refused', x.status === 400, `got ${x.status}`)
  const pdf = new Blob(['%PDF-1.4\n% e2etest\n%%EOF\n'], { type: 'application/pdf' })
  const { error: upErr } = await anon.storage.from(BUCKET).uploadToSignedUrl(prep.path, prep.token, pdf, { contentType: 'application/pdf' })
  check('signed upload into the private bucket', !upErr, upErr?.message)
  x = await a.call('POST', '/api/account/resale-certificate', { action: 'save', path: prep.path, fileName: 'Seller Permit.pdf', state: 'ca', permitNumber: 'SR-1', expiresOn: '2027-06-30' })
  check('save valid certificate (pending, state uppercased, no file_path leaked)', x.status === 200 && x.json?.certificate?.status === 'pending' && x.json.certificate.state === 'CA' && !('file_path' in x.json.certificate), x.text.slice(0, 200))
  x = await b.call('POST', '/api/account/resale-certificate', { action: 'save', path: prep.path, state: 'CA', permitNumber: '1' })
  check("another customer can't claim that file", x.status === 400, `got ${x.status}`)
  x = await b.call('GET', '/api/account/resale-certificate')
  check("another customer doesn't see it", x.status === 200 && x.json?.certificate === null, x.text.slice(0, 200))
  const { error: dlErr } = await anon.storage.from(BUCKET).download(prep.path)
  check('anon key cannot download the file', !!dlErr)
  const pub = await fetch(anon.storage.from(BUCKET).getPublicUrl(prep.path).data.publicUrl)
  check('public URL does not serve the file', pub.status >= 400, `got ${pub.status}`)
  const { data: anonCerts } = await anon.from('resale_certificates').select('id')
  check('anon key reads 0 certificate rows', (anonCerts ?? []).length === 0)

  // ── Address book ─────────────────────────────────────────────────────────
  section('Ship-to address book')
  x = await a.call('POST', '/api/account/addresses', { label: 'Main', address1: '12 Main St', city: 'Austin', state: 'tx', zip: '78701' })
  check('first address saved as default', x.status === 200 && x.json?.addresses?.[0]?.is_default === true && x.json.addresses[0].state === 'TX', x.text.slice(0, 200))
  const firstId = x.json?.addresses?.[0]?.id
  x = await a.call('POST', '/api/account/addresses', { address1: '9 Oak Ave', city: 'Dallas', state: 'TX', zip: '75201' })
  const secondId = x.json?.addresses?.find((q) => q.id !== firstId)?.id
  x = await a.call('PATCH', '/api/account/addresses', { id: secondId, setDefault: true })
  check('set default leaves exactly one default', x.json?.addresses?.filter((q) => q.is_default).length === 1 && x.json.addresses.find((q) => q.is_default)?.id === secondId)
  for (const [verb, call] of [
    ['view', () => b.call('GET', '/api/account/addresses')],
    ['set default', () => b.call('PATCH', '/api/account/addresses', { id: firstId, setDefault: true })],
    ['edit', () => b.call('PATCH', '/api/account/addresses', { id: firstId, address1: 'hijack', city: 'x', state: 'x', zip: '1' })],
    ['delete', () => b.call('DELETE', `/api/account/addresses?id=${firstId}`)],
  ]) {
    const res = await call()
    const ok = verb === 'view' ? res.status === 200 && res.json?.addresses?.length === 0 : res.status === 404
    check(`another customer can't ${verb} it`, ok, `got ${res.status}`)
  }
  x = await a.call('DELETE', `/api/account/addresses?id=${secondId}`)
  check('deleting the default promotes the remaining address', x.json?.addresses?.length === 1 && x.json.addresses[0].id === firstId && x.json.addresses[0].is_default, x.text.slice(0, 200))

  // ── Line card (rep) ──────────────────────────────────────────────────────
  section('Line card')
  const rep = await signIn('rep', { role: 'rep' })
  x = await a.call('GET', '/rep/line-card')
  check('a customer is redirected away from /rep/line-card', x.status >= 300 && x.status < 400)
  x = await rep.call('GET', '/admin/line-card')
  check("a rep can't open /admin/line-card", x.status >= 300 && x.status < 400)
  const { data: cat } = await admin.from('categories').select('id, slug').order('display_order').limit(1).single()
  const { data: visible } = await admin.from('products').select('id').eq('category_id', cat.id).eq('is_active', true).eq('manually_hidden', false).gt('price_cents', 0)
  x = await rep.call('GET', `/rep/line-card?cat=${cat.slug}`)
  check(`card count matches the DB for ${cat.slug} (${visible.length})`, count(x.text, 'class="flex break-inside-avoid flex-col') === visible.length, `page ${count(x.text, 'class="flex break-inside-avoid flex-col')}`)
  x = await rep.call('GET', `/rep/line-card?cat=${cat.slug}&hideprices=1`)
  check('hide prices removes every price', count(x.text, 'class="text-sm font-bold">$') === 0)
  check('no QR codes unless asked', count(x.text, 'data-qr-url="') === 0)
  x = await rep.call('GET', `/rep/line-card?cat=${cat.slug}&qr=1`)
  const qrUrls = [...x.text.matchAll(/data-qr-url="([^"]+)"/g)].map((m) => m[1])
  const expectedUrls = new Set(visible.map((p) => `https://lyusa.app/product/${p.id}`))
  check(`qr=1 puts one QR per card, each linking to that product (${visible.length})`, qrUrls.length === visible.length && qrUrls.every((u) => expectedUrls.has(u)) && new Set(qrUrls).size === qrUrls.length, `${qrUrls.length} codes`)
  const sample = await fetch(qrUrls[0], { redirect: 'manual' })
  check('a QR target URL is a live page on the site', sample.status < 400, `${qrUrls[0]} -> ${sample.status}`)

  // ── Priced line cards and customer pricing ───────────────────────────────
  section('Pricing (line card, price list, cart)')
  // The exact function an order uses (Node runs the .ts directly).
  const { applyTierDiscount } = await import('../lib/order-rules.ts')
  const prices = (html) => [...html.matchAll(/class="text-sm font-bold">\$([0-9.]+)</g)].map((m) => Math.round(Number(m[1]) * 100))
  const { data: tier } = await admin.from('price_tiers').select('code, label, discount_percent').eq('active', true).gt('discount_percent', 0).order('display_order').limit(1).single()
  const catalogPrices = prices((await rep.call('GET', `/rep/line-card?cat=${cat.slug}`)).text)
  x = await rep.call('GET', `/rep/line-card?cat=${cat.slug}&price=tier:${tier.code}`)
  const tierPrices = prices(x.text)
  check(
    `${tier.label} tier card = applyTierDiscount(catalog, ${Number(tier.discount_percent)}) on every product`,
    tierPrices.length === catalogPrices.length && tierPrices.length > 0 && tierPrices.every((p, i) => p === applyTierDiscount(catalogPrices[i], Number(tier.discount_percent))),
    `${tierPrices.length} vs ${catalogPrices.length}`,
  )
  check('the header says what it is priced at', x.text.includes(`Prices for ${tier.label} tier`))
  x = await rep.call('GET', `/rep/line-card?cat=${cat.slug}&price=tier:not_a_tier`)
  check('an unknown tier falls back to catalog price', JSON.stringify(prices(x.text)) === JSON.stringify(catalogPrices))

  // A customer profile with a FLAT discount: the cart preview, the priced line
  // card and the order rule must all agree (the cart used to ignore it).
  const { data: prof, error: profErr } = await admin.from('customers').insert({ email: a.email, name: 'E2E Flat', discount_percent: 15 }).select('id').single()
  if (profErr) throw profErr
  const { data: product } = await admin.from('products').select('id, price_cents').eq('category_id', cat.id).eq('is_active', true).eq('manually_hidden', false).gt('price_cents', 0).is('volume_tiers', null).limit(1).single()
  x = await a.call('POST', '/api/cart/reprice', { items: [{ productId: product.id, qty: 1 }] })
  check('cart shows a flat-discount customer their price', x.json?.prices?.[product.id] === applyTierDiscount(product.price_cents, 15), `${x.json?.prices?.[product.id]} vs ${applyTierDiscount(product.price_cents, 15)}`)
  x = await b.call('POST', '/api/cart/reprice', { items: [{ productId: product.id, qty: 1 }] })
  check("another customer doesn't get that discount", x.json?.prices?.[product.id] === product.price_cents)
  x = await rep.call('GET', `/rep/line-card?skus=${encodeURIComponent((await admin.from('products').select('sku').eq('id', product.id).single()).data.sku)}&price=customer:${prof.id}`)
  check('a customer-priced line card matches the cart', prices(x.text)[0] === applyTierDiscount(product.price_cents, 15) && x.text.includes('E2E Flat (15% off)'))

  // ── Funnel tracking ──────────────────────────────────────────────────────
  section('Funnel tracking')
  for (const type of ['add_to_cart', 'cart_view', 'quote_submitted']) {
    await fetch(`${HOST}/api/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, visitorId }) })
  }
  const { data: events } = await admin.from('analytics_events').select('type').eq('visitor_id', visitorId)
  check('all three funnel steps stored with the visitor id', new Set((events ?? []).map((e) => e.type)).size === 3, JSON.stringify(events))
} catch (e) {
  failures++
  console.log(`\nERROR ${e.message}`)
} finally {
  for (const id of users) await cleanupUser(id)
  await cleanupCustomerProfiles()
  await admin.from('analytics_events').delete().like('visitor_id', `${PREFIX}%`)
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const left = (data?.users ?? []).filter((u) => u.email?.startsWith(PREFIX)).length
  console.log(`\ncleanup: ${left} test user(s) left`)
  console.log(failures ? `\n${failures} FAILED` : '\nall passed')
  process.exit(failures || left ? 1 : 0)
}
