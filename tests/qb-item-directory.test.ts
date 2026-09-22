import { describe, it, expect } from 'vitest'
import { resolveSku, type QbDirectoryRow } from '@/lib/qb-item-directory'

const row = (over: Partial<QbDirectoryRow> = {}): QbDirectoryRow => ({
  sku: 'F288096',
  full_name: 'F288096',
  sales_desc: 'Heart Shaped Flower Holder - 40/cs',
  item_type: 'Inventory',
  sales_price: 4.5,
  is_active: true,
  ...over,
})

describe('resolveSku', () => {
  it('names a SKU from its single QuickBooks record', () => {
    const r = resolveSku('F288096', [row()])
    expect(r.match?.sales_desc).toBe('Heart Shaped Flower Holder - 40/cs')
    expect(r.problem).toBeUndefined()
  })

  it('reports missing when QuickBooks has no such item', () => {
    // The actionable case: these are the SKUs to go type into QuickBooks.
    expect(resolveSku('CM072601', undefined).problem).toBe('missing')
    expect(resolveSku('CM072601', []).problem).toBe('missing')
  })

  it('refuses to choose between two items that reduce to the same SKU', () => {
    // 40 real SKUs have both a bare item and a "Backpack:" sub-item.
    // Picking one silently would name a product from the wrong record.
    const r = resolveSku('B324045', [
      row({ sku: 'B324045', full_name: 'Backpack:B324045', sales_desc: 'one' }),
      row({ sku: 'B324045', full_name: 'B324045', sales_desc: 'two' }),
    ])
    expect(r.problem).toBe('ambiguous')
    expect(r.match).toBeUndefined()
    expect(r.candidates).toHaveLength(2)
  })

  it('prefers the active item when only one candidate is active', () => {
    // A real disambiguation rather than a guess.
    const r = resolveSku('B324045', [
      row({ full_name: 'Backpack:B324045', sales_desc: 'retired', is_active: false }),
      row({ full_name: 'B324045', sales_desc: 'current', is_active: true }),
    ])
    expect(r.match?.sales_desc).toBe('current')
  })

  it('still names a SKU whose only record is inactive', () => {
    // Discontinued in QuickBooks is worth knowing, but the description is
    // just as usable — and the container arrived regardless.
    expect(resolveSku('F1', [row({ is_active: false })]).match?.sales_desc).toBeTruthy()
  })

  it('reports no_description rather than filling a blank name', () => {
    expect(resolveSku('F1', [row({ sales_desc: null })]).problem).toBe('no_description')
    expect(resolveSku('F1', [row({ sales_desc: '   ' })]).problem).toBe('no_description')
  })

  it('ignores a description-less duplicate instead of calling it ambiguous', () => {
    const r = resolveSku('F1', [row({ sales_desc: null, full_name: 'Old:F1' }), row({ sales_desc: 'real name' })])
    expect(r.match?.sales_desc).toBe('real name')
  })
})
