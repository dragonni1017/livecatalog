import { describe, expect, it } from 'vitest'
import { companyKey, creditHistory, historyLine } from '@/lib/credit-history'

const app = { id: 'a2', email: 'Buyer@Shop.com ', company_name: 'Acme Floral, Inc.', created_at: '2026-09-01T00:00:00Z' }
const order = (email: string, status: string, cents: number, created_at: string, dismissed_at: string | null = null) => ({
  customer_email: email,
  status,
  subtotal_cents: cents,
  created_at,
  dismissed_at,
})
const empty = { orders: [], customers: [], qbCustomers: [], erplyLinks: [], applications: [] }

describe('companyKey', () => {
  it('ignores case, punctuation and company suffixes; too-short names never match', () => {
    expect(companyKey('Acme Floral, Inc.')).toBe(companyKey('ACME FLORAL LLC'))
    expect(companyKey('Co')).toBe('')
    expect(companyKey(null)).toBe('')
  })
})

describe('creditHistory', () => {
  it('summarises quotes by email, ignoring dismissed ones', () => {
    const h = creditHistory(app, {
      ...empty,
      orders: [
        order('buyer@shop.com', 'converted', 120000, '2026-06-01T00:00:00Z'),
        order('BUYER@shop.com', 'new', 5000, '2026-08-01T00:00:00Z'),
        order('buyer@shop.com', 'new', 999, '2026-08-02T00:00:00Z', '2026-08-03T00:00:00Z'),
        order('other@shop.com', 'converted', 7, '2026-07-01T00:00:00Z'),
      ],
    })
    expect(h).toMatchObject({ quotes: 2, converted: 1, convertedCents: 120000, open: 1, firstQuote: '2026-06-01T00:00:00Z', lastQuote: '2026-08-01T00:00:00Z' })
    expect(historyLine(h)).toBe('2 quotes, 1 converted ($1,200)')
  })

  it('matches QuickBooks by email first, then by company name', () => {
    const byEmail = creditHistory(app, { ...empty, qbCustomers: [{ full_name: 'Acme', company_name: 'Acme Floral', email: 'buyer@shop.com' }] })
    expect(byEmail.quickBooks).toEqual({ by: 'email', name: 'Acme Floral' })
    const byName = creditHistory(app, { ...empty, qbCustomers: [{ full_name: 'ACME FLORAL LLC', company_name: null, email: 'ap@acme.com' }] })
    expect(byName.quickBooks).toEqual({ by: 'company name', name: 'ACME FLORAL LLC' })
    expect(creditHistory(app, { ...empty, qbCustomers: [{ full_name: 'Other Co', company_name: 'Other', email: null }] }).quickBooks).toBeNull()
  })

  it('finds Erply, catalog account and earlier applications', () => {
    const h = creditHistory(app, {
      ...empty,
      erplyLinks: [{ email: 'buyer@shop.com', erply_customer_id: '42', erply_tier: 'Wholesale' }],
      customers: [{ email: 'buyer@shop.com', price_tier_code: 'gold', created_at: '2026-01-01T00:00:00Z' }],
      applications: [
        { id: 'a1', email: 'x@y.com', company_name: 'Acme Floral', status: 'denied', created_at: '2026-03-01T00:00:00Z' },
        { ...app, status: 'pending' },
        { id: 'a3', email: 'buyer@shop.com', company_name: 'Acme', status: 'pending', created_at: '2026-10-01T00:00:00Z' },
      ],
    })
    expect(h.erply).toEqual({ tier: 'Wholesale' })
    expect(h.catalogCustomer).toEqual({ since: '2026-01-01T00:00:00Z', tier: 'gold' })
    expect(h.earlierApplications).toEqual([{ status: 'denied', created_at: '2026-03-01T00:00:00Z' }])
    expect(historyLine(h)).toBe('No quotes on the site · in Erply · applied before (1)')
  })

  it('says "new to us" when nothing matches', () => {
    expect(historyLine(creditHistory(app, empty))).toBe('No quotes on the site · new to us')
  })
})
