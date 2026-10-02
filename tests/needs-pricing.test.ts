import { describe, it, expect } from 'vitest'
import {
  MAX_SKUS_PER_REQUEST,
  buildReceivingCohort,
  isReadyToShow,
  needsErplyPrice,
  parseSkuList,
  planPricePull,
  unhideBlocker,
  type CatalogPriceRow,
} from '../lib/needs-pricing'
import { syncPriceCents } from '../lib/erply'

describe('buildReceivingCohort', () => {
  it('keeps only lines receiving created in Erply, upper-cased', () => {
    const cohort = buildReceivingCohort([
      { sku: 'fd400004-25yard', erply_created_product_id: 3123 },
      { sku: 'K229582', erply_created_product_id: '3124' },
      { sku: 'B111', erply_created_product_id: null },
      { sku: 'B222', erply_created_product_id: '' },
      { sku: null, erply_created_product_id: 1 },
      { sku: '  ', erply_created_product_id: 2 },
    ])
    expect([...cohort].sort()).toEqual(['FD400004-25YARD', 'K229582'])
  })
})

describe('ready to show', () => {
  const cohort = new Set(['K229582'])
  const row = { sku: 'K229582', is_active: true, manually_hidden: true, price_cents: 425 }

  it('accepts a priced, hidden, active cohort product (case-insensitive SKU)', () => {
    expect(isReadyToShow(row, cohort)).toBe(true)
    expect(isReadyToShow({ ...row, sku: 'k229582' }, cohort)).toBe(true)
  })

  it('never offers a product hidden by choice (outside the cohort)', () => {
    expect(unhideBlocker({ ...row, sku: 'F286606' }, cohort)).toBe('not_in_cohort')
  })

  it('refuses unpriced, inactive or already-visible rows', () => {
    expect(unhideBlocker({ ...row, price_cents: 0 }, cohort)).toBe('not_priced')
    expect(unhideBlocker({ ...row, price_cents: null }, cohort)).toBe('not_priced')
    expect(unhideBlocker({ ...row, price_cents: -100 }, cohort)).toBe('not_priced')
    expect(unhideBlocker({ ...row, is_active: false }, cohort)).toBe('inactive')
    expect(unhideBlocker({ ...row, manually_hidden: false }, cohort)).toBe('not_hidden')
    expect(unhideBlocker({ ...row, manually_hidden: null }, cohort)).toBe('not_hidden')
  })
})

describe('needsErplyPrice', () => {
  it('is active products at or below zero, or with no price', () => {
    const base = { sku: 'X', manually_hidden: true }
    expect(needsErplyPrice({ ...base, is_active: true, price_cents: 0 })).toBe(true)
    expect(needsErplyPrice({ ...base, is_active: true, price_cents: null })).toBe(true)
    expect(needsErplyPrice({ ...base, is_active: true, price_cents: 1 })).toBe(false)
    expect(needsErplyPrice({ ...base, is_active: false, price_cents: 0 })).toBe(false)
  })
})

describe('parseSkuList', () => {
  it('trims, drops non-strings and blanks, de-duplicates, keeps case', () => {
    expect(parseSkuList({ skus: [' K1 ', 'K1', 'k1', 7, '', null] })).toEqual({ skus: ['K1', 'k1'] })
  })

  it('rejects a missing, empty or oversized list', () => {
    expect(parseSkuList(null)).toHaveProperty('error')
    expect(parseSkuList({ skus: 'K1' })).toHaveProperty('error')
    expect(parseSkuList({ skus: [] })).toHaveProperty('error')
    const many = Array.from({ length: MAX_SKUS_PER_REQUEST + 1 }, (_, i) => `S${i}`)
    expect(parseSkuList({ skus: many })).toHaveProperty('error')
    expect(parseSkuList({ skus: many.slice(1) })).toEqual({ skus: many.slice(1) })
  })
})

describe('planPricePull', () => {
  const cat = (sku: string, price_cents: number | null, is_active = true): CatalogPriceRow => ({
    id: `id-${sku}`,
    sku,
    is_active,
    price_cents,
  })

  it('updates only unpriced active rows that Erply now prices', () => {
    const plan = planPricePull(
      ['A', 'B', 'C', 'D'],
      [cat('A', 0), cat('B', 0), cat('C', null), cat('D', 0)],
      [
        { sku: 'A', price_cents: 425 },
        { sku: 'B', price_cents: 0 },
        { sku: 'C', price_cents: 1000 },
      ],
    )
    expect(plan.updates).toEqual([
      { id: 'id-A', sku: 'A', from: 0, to: 425 },
      { id: 'id-C', sku: 'C', from: 0, to: 1000 },
    ])
    expect(plan.stillZeroInErply).toEqual(['B'])
    expect(plan.notInErply).toEqual(['D'])
    expect(plan.skipped).toEqual([])
  })

  it('never moves a real price, never touches inactive or unknown rows', () => {
    const plan = planPricePull(
      ['P', 'I', 'Z'],
      [cat('P', 500), cat('I', 0, false)],
      [
        { sku: 'P', price_cents: 900 },
        { sku: 'I', price_cents: 900 },
      ],
    )
    expect(plan.updates).toEqual([])
    expect(plan.skipped.map((s) => s.sku)).toEqual(['P', 'I', 'Z'])
  })

  it('reports a case-only Erply match instead of calling it missing', () => {
    const plan = planPricePull(['P273813-45CM'], [cat('P273813-45CM', 0)], [{ sku: 'P273813-45cm', price_cents: 300 }])
    expect(plan.updates).toEqual([])
    expect(plan.notInErply).toEqual([])
    expect(plan.skipped[0].reason).toMatch(/P273813-45cm/)
  })

  it('refuses duplicate Erply codes that disagree, accepts ones that agree', () => {
    const disagree = planPricePull(['F288132'], [cat('F288132', 0)], [
      { sku: 'F288132', price_cents: 300 },
      { sku: 'F288132', price_cents: 0 },
    ])
    expect(disagree.updates).toEqual([])
    expect(disagree.skipped).toHaveLength(1)

    const agree = planPricePull(['F288132'], [cat('F288132', 0)], [
      { sku: 'F288132', price_cents: 300 },
      { sku: 'F288132', price_cents: 300 },
    ])
    expect(agree.updates).toEqual([{ id: 'id-F288132', sku: 'F288132', from: 0, to: 300 }])
  })
})

describe('syncPriceCents', () => {
  it('converts the normalized dollar price exactly as the sync always has', () => {
    expect(syncPriceCents({ price: 4.25 })).toBe(425)
    expect(syncPriceCents({ price: 0 })).toBe(0)
    // Float noise from the quarter rounding must not leave a stray cent.
    expect(syncPriceCents({ price: 0.1 + 0.2 })).toBe(30)
  })
})
