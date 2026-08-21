import { describe, it, expect } from 'vitest'
import { validateOrderInput, validateOrderMinimum } from '@/lib/order-validation'

const validContact = {
  name: 'Jane Smith',
  email: 'jane@example.com',
  phone: '555-1234',
  company: 'Acme Co',
  shipAddress1: '123 Main St',
  shipCity: 'Vernon',
  shipState: 'CA',
  shipZip: '90058',
}

const validItems = [{ productId: 'abc-123', qty: 2 }]

describe('validateOrderInput', () => {
  it('accepts a valid contact and items', () => {
    const result = validateOrderInput({ contact: validContact, items: validItems })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.contact.email).toBe('jane@example.com')
      expect(result.items).toHaveLength(1)
    }
  })

  it('rejects when name is missing', () => {
    const result = validateOrderInput({ contact: { ...validContact, name: '' }, items: validItems })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejects when email is missing', () => {
    const result = validateOrderInput({ contact: { ...validContact, email: '' }, items: validItems })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejects when the shipping address is incomplete', () => {
    for (const field of ['shipAddress1', 'shipCity', 'shipState', 'shipZip'] as const) {
      const result = validateOrderInput({ contact: { ...validContact, [field]: '' }, items: validItems })
      expect(result.ok, `expected rejection when ${field} is missing`).toBe(false)
      if (!result.ok) expect(result.status).toBe(400)
    }
  })

  it('rejects when name is whitespace only', () => {
    const result = validateOrderInput({ contact: { ...validContact, name: '   ' }, items: validItems })
    expect(result.ok).toBe(false)
  })

  it('rejects an empty cart', () => {
    const result = validateOrderInput({ contact: validContact, items: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('filters out items with zero or negative qty', () => {
    const items = [
      { productId: 'abc-123', qty: 2 },
      { productId: 'xyz-456', qty: 0 },
      { productId: 'bad-789', qty: -1 },
    ]
    const result = validateOrderInput({ contact: validContact, items })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.items).toHaveLength(1)
  })

  it('filters out items missing a productId', () => {
    const items = [{ productId: '', qty: 3 }, { productId: 'abc-123', qty: 1 }]
    const result = validateOrderInput({ contact: validContact, items })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.items).toHaveLength(1)
  })

  it('rejects when all items are invalid', () => {
    const items = [{ productId: '', qty: 0 }]
    const result = validateOrderInput({ contact: validContact, items })
    expect(result.ok).toBe(false)
  })

  it('handles a completely empty body', () => {
    const result = validateOrderInput({})
    expect(result.ok).toBe(false)
  })

  it('handles null body', () => {
    const result = validateOrderInput(null)
    expect(result.ok).toBe(false)
  })
})

describe('validateOrderMinimum', () => {
  it('returns null when subtotal meets the minimum', () => {
    expect(validateOrderMinimum(10000)).toBeNull()
  })

  it('returns null for any positive amount when minimum is 0', () => {
    expect(validateOrderMinimum(1)).toBeNull()
  })

  it('returns null for zero when minimum is 0', () => {
    expect(validateOrderMinimum(0)).toBeNull()
  })
})
