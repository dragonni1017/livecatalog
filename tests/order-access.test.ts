import { describe, expect, it } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { canAccessOrder, ilikeExact, orderUrl } from '../lib/order-access'

const order = {
  access_token: 'a'.repeat(32),
  customer_email: 'Buyer@Shop.com',
  rep_user_id: 'rep-1',
}
const user = (email: string | null, role?: string, id = 'u-1') =>
  ({ id, email, app_metadata: role ? { role } : {} }) as unknown as User

describe('canAccessOrder', () => {
  it('denies the guessable reference alone', () => {
    expect(canAccessOrder(order, {})).toBe(false)
    expect(canAccessOrder(order, { token: null, user: null })).toBe(false)
  })

  it('accepts the exact link token and nothing close', () => {
    expect(canAccessOrder(order, { token: 'a'.repeat(32) })).toBe(true)
    expect(canAccessOrder(order, { token: 'a'.repeat(31) })).toBe(false)
    expect(canAccessOrder(order, { token: '' })).toBe(false)
    expect(canAccessOrder({ ...order, access_token: null }, { token: '' })).toBe(false)
  })

  it('accepts the customer signed in with the order email, any case', () => {
    expect(canAccessOrder(order, { user: user(' buyer@shop.COM ') })).toBe(true)
    expect(canAccessOrder(order, { user: user('someone@else.com') })).toBe(false)
    expect(canAccessOrder({ ...order, customer_email: null }, { user: user('') })).toBe(false)
  })

  it('accepts admins, and only the rep who placed it', () => {
    expect(canAccessOrder(order, { user: user('a@lyusa.app', 'admin') })).toBe(true)
    expect(canAccessOrder(order, { user: user('r@lyusa.app', 'rep', 'rep-1') })).toBe(true)
    expect(canAccessOrder(order, { user: user('r2@lyusa.app', 'rep', 'rep-2') })).toBe(false)
    expect(canAccessOrder({ ...order, rep_user_id: null }, { user: user('r@lyusa.app', 'rep', 'rep-1') })).toBe(false)
  })
})

describe('orderUrl', () => {
  it('builds a lyusa.app link carrying the token', () => {
    expect(orderUrl('ORD-2026-0042', 'abc')).toBe('https://lyusa.app/order/ORD-2026-0042?t=abc')
    expect(orderUrl('ORD-2026-0042', null)).toBe('https://lyusa.app/order/ORD-2026-0042')
  })
})

describe('ilikeExact', () => {
  it('escapes LIKE wildcards so an email matches only itself', () => {
    expect(ilikeExact('a_b@x.com')).toBe('a\\_b@x.com')
    expect(ilikeExact('100%@x.com')).toBe('100\\%@x.com')
    expect(ilikeExact('back\\slash@x.com')).toBe('back\\\\slash@x.com')
    expect(ilikeExact('plain@x.com')).toBe('plain@x.com')
  })
})
