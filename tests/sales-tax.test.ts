import { describe, expect, it } from 'vitest'
import {
  activeRates, estimateSalesTax, orderTaxLine, parseSalesTaxInput, taxColumns, taxMemoLine, taxOn, taxTextLines,
  type TaxCertificate,
} from '@/lib/sales-tax'

const TODAY = '2026-10-19'
const rates = activeRates([
  { state: 'CA', rate_percent: '7.2500', is_active: true },
  { state: 'TX', rate_percent: 6.25, is_active: true },
  { state: 'NV', rate_percent: 6.85, is_active: false },
])
const cert = (over: Partial<TaxCertificate> = {}): TaxCertificate => ({
  state: 'CA', status: 'verified', expires_on: null, replaced_at: null, ...over,
})
const est = (shipState: string | null, certificates: TaxCertificate[] = [], subtotalCents = 10_000) =>
  estimateSalesTax({ shipState, subtotalCents, rates, certificates, today: TODAY })

describe('activeRates', () => {
  it('keeps active rows only and reads numeric strings', () => {
    expect([...rates]).toEqual([['CA', 7.25], ['TX', 6.25]])
  })
})

describe('taxOn', () => {
  it('rounds half up to the cent', () => {
    expect(taxOn(1000, 7.25)).toBe(73) // 72.5
    expect(taxOn(999, 7.25)).toBe(72) // 72.4275
    expect(taxOn(10_000, 8.875)).toBe(888) // 887.5
  })

  it('is exact where floating point would drift', () => {
    expect(taxOn(1_000_000_00, 7.75)).toBe(7_750_000)
  })

  it('charges nothing on a zero subtotal or rate', () => {
    expect(taxOn(0, 7.25)).toBe(0)
    expect(taxOn(1000, 0)).toBe(0)
  })
})

describe('estimateSalesTax', () => {
  it('taxes a state with an active rate', () => {
    expect(est('CA')).toEqual({ state: 'CA', ratePercent: 7.25, taxCents: 725, exemptReason: null, certificatePending: false })
  })

  it('normalizes the ship-to state', () => {
    expect(est('texas').taxCents).toBe(625)
  })

  it('does not collect where there is no active rate', () => {
    for (const s of ['NV', 'FL', null, 'Narnia']) {
      expect(est(s)).toMatchObject({ taxCents: 0, exemptReason: 'not_collected', ratePercent: null })
    }
  })

  it('exempts a verified, current certificate for the ship-to state', () => {
    expect(est('CA', [cert()])).toMatchObject({ taxCents: 0, exemptReason: 'resale_certificate' })
    expect(est('CA', [cert({ expires_on: TODAY })]).exemptReason).toBe('resale_certificate')
  })

  it('ignores certificates for another state, expired, or replaced', () => {
    for (const c of [cert({ state: 'TX' }), cert({ expires_on: '2026-10-18' }), cert({ replaced_at: '2026-10-01T00:00:00Z' })]) {
      expect(est('CA', [c])).toMatchObject({ taxCents: 725, exemptReason: null })
    }
  })

  it('taxes but flags a pending certificate; a rejected one does nothing', () => {
    expect(est('CA', [cert({ status: 'pending' })])).toMatchObject({ taxCents: 725, certificatePending: true })
    expect(est('CA', [cert({ status: 'rejected' })])).toMatchObject({ taxCents: 725, certificatePending: false })
  })
})

describe('parseSalesTaxInput', () => {
  it('accepts a valid row and upper-cases the state', () => {
    expect(parseSalesTaxInput({ state: 'ca', rate_percent: '7.25', is_active: true, note: ' base ' }))
      .toEqual({ value: { state: 'CA', rate_percent: 7.25, is_active: true, note: 'base' } })
  })

  it('rejects bad states, rates and notes', () => {
    expect(parseSalesTaxInput({ state: 'ZZ', rate_percent: '5' })).toHaveProperty('error')
    expect(parseSalesTaxInput({ state: 'CA', rate_percent: '7.12345' })).toHaveProperty('error')
    expect(parseSalesTaxInput({ state: 'CA', rate_percent: '-1' })).toHaveProperty('error')
    expect(parseSalesTaxInput({ state: 'CA', rate_percent: '21' })).toHaveProperty('error')
    expect(parseSalesTaxInput({ state: 'CA', rate_percent: '5', note: 'x'.repeat(201) })).toHaveProperty('error')
  })
})

describe('orderTaxLine / taxTextLines / taxMemoLine', () => {
  const taxed = { tax_state: 'CA', tax_rate_percent: '7.2500', tax_estimate_cents: 725, tax_exempt_reason: null }
  const exempt = { tax_state: 'CA', tax_rate_percent: null, tax_estimate_cents: 0, tax_exempt_reason: 'resale_certificate' }
  const notCollected = { tax_state: 'NV', tax_rate_percent: null, tax_estimate_cents: 0, tax_exempt_reason: 'not_collected' }
  const legacy = { tax_state: null, tax_rate_percent: null, tax_estimate_cents: null, tax_exempt_reason: null }

  it('labels a taxed order with state and rate', () => {
    expect(orderTaxLine(taxed)).toEqual({ label: 'Estimated sales tax (CA 7.25%)', cents: 725 })
    expect(taxTextLines(taxed, 10_000)).toEqual(['Estimated sales tax (CA 7.25%): $7.25', 'Estimated total: $107.25'])
    expect(taxMemoLine(taxed)).toBe('Est. tax CA 7.25%: $7.25 (app estimate)')
  })

  it('labels an exempt order without an amount', () => {
    expect(orderTaxLine(exempt)).toEqual({ label: 'Sales tax: exempt (resale certificate, CA)', cents: 0 })
    expect(taxTextLines(exempt, 10_000)).toEqual(['Sales tax: exempt (resale certificate, CA)'])
    expect(taxMemoLine(exempt)).toBe('Tax exempt: resale cert CA')
  })

  it('shows nothing for not-collected states and orders from before 0066', () => {
    for (const o of [notCollected, legacy, {}]) {
      expect(orderTaxLine(o)).toBeNull()
      expect(taxTextLines(o, 10_000)).toEqual([])
      expect(taxMemoLine(o)).toBeNull()
    }
  })

  it('maps an estimate to the order columns', () => {
    expect(taxColumns(est('CA'))).toEqual({ tax_state: 'CA', tax_rate_percent: 7.25, tax_estimate_cents: 725, tax_exempt_reason: null })
    expect(taxColumns(est(null))).toEqual({ tax_state: null, tax_rate_percent: null, tax_estimate_cents: 0, tax_exempt_reason: 'not_collected' })
  })
})
