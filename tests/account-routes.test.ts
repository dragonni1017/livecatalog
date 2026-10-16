import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The guards on the public /api/account/* routes: a session is required, input
// is validated, and another customer's ids/paths are refused. The database
// client is replaced by one that throws on ANY access, so every case here also
// proves the request was rejected before touching the DB or storage.
// (Happy paths need the real DB: see `npm run test:e2e`.)

const session = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }))
vi.mock('../lib/auth-server', () => ({
  getSessionUser: async () => session.user,
}))
vi.mock('../lib/supabase', () => ({
  getAdminClient: () =>
    new Proxy({}, {
      get(_t, prop) {
        throw new Error(`DB touched: .${String(prop)}`)
      },
    }),
}))

import * as certRoute from '../app/api/account/resale-certificate/route'
import * as addrRoute from '../app/api/account/addresses/route'

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const OBJ = '33333333-3333-4333-8333-333333333333'

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  session.user = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('/api/account/resale-certificate', () => {
  const URL_ = 'http://x/api/account/resale-certificate'

  it('requires a session for GET and POST', async () => {
    expect((await certRoute.GET()).status).toBe(401)
    expect((await certRoute.POST(post(URL_, { action: 'prepare', filename: 'a.pdf' }))).status).toBe(401)
  })

  describe('signed in', () => {
    beforeEach(() => {
      session.user = { id: ME, email: 'Buyer@Example.com' }
    })

    it('prepare rejects file types the bucket would refuse', async () => {
      for (const filename of ['cert.exe', 'cert.html', 'cert', 'cert.pdf.exe', 'cert.gif']) {
        expect((await certRoute.POST(post(URL_, { action: 'prepare', filename }))).status).toBe(400)
      }
    })

    it("save refuses a path outside the caller's own folder", async () => {
      const cases = [
        `${OTHER}/${OBJ}.pdf`, // another customer's folder
        `${ME}/../${OTHER}/${OBJ}.pdf`, // traversal
        `${ME}/${OBJ}.pdf/../../x.pdf`,
        `${ME}/nested/${OBJ}.pdf`, // must be directly in the folder
        `${ME}/${OBJ}.exe`, // wrong extension
        `${ME}/not-a-uuid.pdf`,
        `/${ME}/${OBJ}.pdf`,
        '',
      ]
      for (const path of cases) {
        const res = await certRoute.POST(post(URL_, { action: 'save', path, state: 'CA', permitNumber: '1' }))
        expect(res.status, path).toBe(400)
      }
    })

    it('save validates state, permit number and date before storage is checked', async () => {
      const path = `${ME}/${OBJ}.pdf`
      const bad = [
        { state: 'ZZ', permitNumber: '1' },
        { state: '', permitNumber: '1' },
        { state: 'CA', permitNumber: '' },
        { state: 'CA', permitNumber: 'x'.repeat(65) },
        { state: 'CA', permitNumber: '1', expiresOn: '2027-13-45' },
        { state: 'CA', permitNumber: '1', expiresOn: 'next year' },
      ]
      for (const b of bad) {
        expect((await certRoute.POST(post(URL_, { action: 'save', path, ...b }))).status, JSON.stringify(b)).toBe(400)
      }
    })

    it('rejects an unknown action', async () => {
      expect((await certRoute.POST(post(URL_, { action: 'delete-everything' }))).status).toBe(400)
    })
  })
})

describe('/api/account/addresses', () => {
  const URL_ = 'http://x/api/account/addresses'
  const good = { address1: '12 Main St', city: 'Austin', state: 'TX', zip: '78701' }

  it('requires a session for every method', async () => {
    expect((await addrRoute.GET()).status).toBe(401)
    expect((await addrRoute.POST(post(URL_, good))).status).toBe(401)
    expect((await addrRoute.PATCH(new NextRequest(URL_, { method: 'PATCH', body: JSON.stringify({ id: OBJ, setDefault: true }) }))).status).toBe(401)
    expect((await addrRoute.DELETE(new NextRequest(`${URL_}?id=${OBJ}`, { method: 'DELETE' }))).status).toBe(401)
  })

  describe('signed in', () => {
    beforeEach(() => {
      session.user = { id: ME, email: 'buyer@example.com' }
    })

    it('POST rejects an incomplete or over-long address', async () => {
      expect((await addrRoute.POST(post(URL_, { ...good, zip: '' }))).status).toBe(400)
      expect((await addrRoute.POST(post(URL_, { ...good, address1: 'a'.repeat(201) }))).status).toBe(400)
      expect((await addrRoute.POST(post(URL_, {}))).status).toBe(400)
    })

    it('PATCH and DELETE treat a non-uuid id as not found (never a DB error)', async () => {
      for (const id of ['', 'abc', "1' or '1'='1", '../x', `${OBJ}x`]) {
        const patch = await addrRoute.PATCH(new NextRequest(URL_, { method: 'PATCH', body: JSON.stringify({ id, setDefault: true }) }))
        expect(patch.status, id).toBe(404)
        const del = await addrRoute.DELETE(new NextRequest(`${URL_}?id=${encodeURIComponent(id)}`, { method: 'DELETE' }))
        expect(del.status, id).toBe(404)
      }
    })
  })
})
