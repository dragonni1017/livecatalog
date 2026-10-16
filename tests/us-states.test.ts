import { describe, expect, it } from 'vitest'
import { normalizeUsState, US_STATES } from '../lib/us-states'
import { parseAddress } from '../lib/customer-addresses'
import { validateOrderInput } from '../lib/order-validation'

describe('normalizeUsState', () => {
  it('codes in any case, with a trailing period', () => {
    for (const v of ['TX', 'tx', 'Tx', ' tx ', 'Tx.']) expect(normalizeUsState(v), v).toBe('TX')
  })
  it('full names in any case', () => {
    expect(normalizeUsState('Texas')).toBe('TX')
    expect(normalizeUsState(' new  york ')).toBe('NY')
    expect(normalizeUsState('district of columbia')).toBe('DC')
  })
  it('the stored messy values from real orders', () => {
    expect(['Fl', 'Tx', 'Texas', 'Nv'].map(normalizeUsState)).toEqual(['FL', 'TX', 'TX', 'NV'])
  })
  it('unknown or empty → null', () => {
    for (const v of ['', '  ', null, undefined, 'Texass', 'XX', 'Ontario', 'Calif']) expect(normalizeUsState(v), String(v)).toBeNull()
  })
  it('the list covers 50 states + DC + PR, all two-letter', () => {
    expect(US_STATES).toHaveLength(52)
    for (const s of US_STATES) expect(s).toMatch(/^[A-Z]{2}$/)
  })
})

describe('saved addresses (strict)', () => {
  const base = { address1: '12 Main St', city: 'Austin', zip: '78701' }
  it('stores the code', () => {
    const r = parseAddress({ ...base, state: 'texas' })
    expect('address' in r && r.address.state).toBe('TX')
  })
  it('refuses a state it cannot recognise', () => {
    expect(parseAddress({ ...base, state: 'Texass' })).toEqual({ error: 'Choose a US state.' })
  })
})

describe('order submission (lenient)', () => {
  const contact = {
    name: 'A', email: 'a@example.com', shipAddress1: '1 Main', shipCity: 'Austin', shipState: 'Texas', shipZip: '78701',
  }
  const items = [{ productId: 'p1', qty: 1 }]
  it('normalizes a recognizable state to its code', () => {
    const r = validateOrderInput({ contact, items })
    expect(r.ok && r.contact.shipState).toBe('TX')
  })
  it("keeps an unrecognized state as typed rather than blocking the quote", () => {
    const r = validateOrderInput({ contact: { ...contact, shipState: 'Ontario' }, items })
    expect(r.ok && r.contact.shipState).toBe('Ontario')
  })
})
