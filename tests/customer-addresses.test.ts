import { describe, expect, it } from 'vitest'
import { addressSummary, parseAddress, sameAddress, type AddressInput } from '../lib/customer-addresses'

const ok = (body: Record<string, unknown>) => {
  const r = parseAddress(body)
  if ('error' in r) throw new Error(r.error)
  return r.address
}

const base = { address1: '12 Main St', city: 'Austin', state: 'tx', zip: '78701' }

describe('parseAddress', () => {
  it('trims, uppercases the state, and nulls empty optional fields', () => {
    expect(ok({ ...base, address1: '  12 Main St ', label: '  ', address2: '' })).toEqual({
      label: null,
      address1: '12 Main St',
      address2: null,
      city: 'Austin',
      state: 'TX',
      zip: '78701',
    })
  })
  it('requires street, city, state and ZIP', () => {
    for (const key of ['address1', 'city', 'state', 'zip']) {
      expect(parseAddress({ ...base, [key]: '' })).toHaveProperty('error')
      expect(parseAddress({ ...base, [key]: '   ' })).toHaveProperty('error')
    }
  })
  it('ignores non-string values instead of crashing', () => {
    expect(parseAddress({ ...base, city: 42 })).toHaveProperty('error')
    expect(ok({ ...base, label: { evil: true } }).label).toBeNull()
  })
  it('enforces the same length limits as the table', () => {
    expect(parseAddress({ ...base, address1: 'a'.repeat(201) })).toHaveProperty('error')
    expect(parseAddress({ ...base, label: 'l'.repeat(61) })).toHaveProperty('error')
    expect(parseAddress({ ...base, zip: '1'.repeat(21) })).toHaveProperty('error')
    expect(ok({ ...base, address1: 'a'.repeat(200) }).address1).toHaveLength(200)
  })
})

describe('sameAddress', () => {
  const a: AddressInput = { label: 'Store', address1: '12 Main St', address2: null, city: 'Austin', state: 'TX', zip: '78701' }
  it('ignores case, spacing and the label', () => {
    expect(sameAddress(a, { ...a, label: null, address1: '12  main st ', city: 'AUSTIN', state: 'tx' })).toBe(true)
  })
  it('treats a missing and an empty line 2 as the same', () => {
    expect(sameAddress(a, { ...a, address2: '' })).toBe(true)
  })
  it('notices a real difference', () => {
    expect(sameAddress(a, { ...a, zip: '78702' })).toBe(false)
    expect(sameAddress(a, { ...a, address2: 'Suite 4' })).toBe(false)
  })
})

describe('addressSummary', () => {
  it('prefixes the label when there is one', () => {
    expect(addressSummary({ label: 'Main St store', address1: '12 Main St', city: 'Austin', state: 'TX', zip: '78701' }))
      .toBe('Main St store — 12 Main St, Austin, TX 78701')
    expect(addressSummary({ label: null, address1: '12 Main St', city: 'Austin', state: 'TX', zip: '78701' }))
      .toBe('12 Main St, Austin, TX 78701')
  })
})
