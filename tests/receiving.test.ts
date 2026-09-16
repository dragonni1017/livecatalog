import { describe, it, expect } from 'vitest'
import { isCreatable, isStockAppliable, missingForCreate, type ReceivingLine } from '@/lib/receiving'

const line = (over: Partial<ReceivingLine> = {}): ReceivingLine => ({
  match_status: 'matched',
  qty_received: 10,
  applied_at: null,
  erply_created_product_id: null,
  ...over,
})

describe('isStockAppliable', () => {
  it('accepts a matched line with pieces that has not been applied', () => {
    expect(isStockAppliable(line())).toBe(true)
  })

  it('refuses a line that was already applied', () => {
    // Erply's registration API is a delta, so a second apply doubles stock.
    expect(isStockAppliable(line({ applied_at: '2026-09-16T00:00:00Z' }))).toBe(false)
  })

  it('refuses a zero received count', () => {
    expect(isStockAppliable(line({ qty_received: 0 }))).toBe(false)
  })

  it('refuses an unmatched SKU', () => {
    expect(isStockAppliable(line({ match_status: 'unmatched_sku' }))).toBe(false)
  })

  it('refuses a barcode mismatch even though the SKU exists', () => {
    // The SKU is in the catalog but the sheet's UPC disagrees, so the mapping
    // is suspect — adding stock to the wrong product is not self-correcting.
    expect(isStockAppliable(line({ match_status: 'barcode_mismatch' }))).toBe(false)
  })

  it('accepts a line whose product was just created in this pass', () => {
    // The create step re-resolves the line to 'matched'; that flip is the
    // whole reason a container can be received in one pass.
    expect(isStockAppliable(line({ match_status: 'matched', erply_created_product_id: 3081 }))).toBe(true)
  })
})

describe('isCreatable', () => {
  it('accepts a SKU that is not in the catalog', () => {
    expect(isCreatable(line({ match_status: 'unmatched_sku' }))).toBe(true)
  })

  it('refuses a barcode mismatch — that SKU already exists', () => {
    // Creating it would ask Erply for a duplicate code, or produce a second
    // product for the same item.
    expect(isCreatable(line({ match_status: 'barcode_mismatch' }))).toBe(false)
  })

  it('refuses a line already created, which is what makes retry safe', () => {
    expect(isCreatable(line({ match_status: 'unmatched_sku', erply_created_product_id: 3081 }))).toBe(false)
  })

  it('refuses a matched line', () => {
    expect(isCreatable(line())).toBe(false)
  })
})

describe('the two predicates together', () => {
  it('never allow the same line to be created and applied at once', () => {
    const states: ReceivingLine[] = [
      line({ match_status: 'matched' }),
      line({ match_status: 'unmatched_sku' }),
      line({ match_status: 'barcode_mismatch' }),
      line({ match_status: 'unmatched_sku', erply_created_product_id: 1 }),
      line({ match_status: 'matched', erply_created_product_id: 1 }),
      line({ match_status: 'matched', applied_at: '2026-09-16T00:00:00Z' }),
      line({ qty_received: 0 }),
    ]
    for (const l of states) {
      expect(isCreatable(l) && isStockAppliable(l)).toBe(false)
    }
  })
})

describe('missingForCreate', () => {
  it('lists every field Erply needs that is absent', () => {
    expect(missingForCreate(line({ match_status: 'unmatched_sku' }))).toEqual(['name', 'category', 'price'])
  })

  it('is empty when the proposal is complete', () => {
    expect(
      missingForCreate(
        line({
          match_status: 'unmatched_sku',
          proposed_name: 'Pizza Squishy - 12/pk 8bx/cs cs.96',
          proposed_category: 'Toys',
          proposed_price_cents: 199,
        }),
      ),
    ).toEqual([])
  })

  it('treats a zero price as supplied, not missing', () => {
    // A free giveaway item is a real thing; absent is the problem, not zero.
    expect(
      missingForCreate(
        line({ match_status: 'unmatched_sku', proposed_name: 'X', proposed_category: 'Toys', proposed_price_cents: 0 }),
      ),
    ).toEqual([])
  })
})
