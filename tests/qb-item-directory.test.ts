import { describe, it, expect } from 'vitest'
import { parsePackSize, resolveSku, type QbDirectoryRow } from '@/lib/qb-item-directory'

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

describe('resolveSku with a case-pack cross-check', () => {
  // The real trap, from container EGSU1396926. QuickBooks' bare F287759 is a
  // heart box at 24/cs; the container ships 1,800 in 15 cartons (120/cs),
  // and F287759-FLOWER is the 120/cs record. Exact SKU equality alone would
  // have written "White Heart Triple Set Fuzzy" onto a box of flowers.
  const heartBox = row({ sku: 'F287759', full_name: 'F287759', sales_desc: 'White Heart Triple Set Fuzzy-24pcs/cs' })
  const flowers = row({ sku: 'F287759-FLOWER', full_name: 'F287759-FLOWER', sales_desc: 'Chenille Stems Gerbera Daisies - 120 pcs/cs' })

  it('refuses an exact match whose case pack contradicts the container', () => {
    const r = resolveSku('F287759', [heartBox], 120, [flowers])
    expect(r.problem).toBe('pack_mismatch')
    expect(r.match).toBeUndefined()
    // The better candidate rides along so the screen can offer it.
    expect(r.candidates?.map((c) => c.sku)).toContain('F287759-FLOWER')
  })

  it('accepts an exact match whose case pack agrees', () => {
    const r = resolveSku('F287759', [heartBox], 24, [])
    expect(r.match?.sales_desc).toContain('White Heart')
    expect(r.basis).toBe('exact+pack')
  })

  it('still accepts an exact match when the container has no pieces-per-case', () => {
    // Nothing to contradict it — a sheet without a cartons column is normal.
    expect(resolveSku('F287759', [heartBox], null, []).match).toBeTruthy()
  })

  it('still accepts an exact match when the description quotes no pack size', () => {
    const r = resolveSku('F1', [row({ sales_desc: 'Just a name, no pack' })], 120, [])
    expect(r.match).toBeTruthy()
    expect(r.basis).toBe('exact')
  })

  it('rescues a SKU with no exact record when one variant agrees on pack size', () => {
    // F287760 was reported "missing" while QuickBooks held "F287760- FLOWER".
    const pk = row({ sku: 'F287760- Pk', sales_desc: 'Pink Velvet Heart Shape- Set of 3pcs - 24/cs' })
    const tulip = row({ sku: 'F287760- FLOWER', sales_desc: 'Chenille Stem Tulip - 120 pcs/cs' })
    const r = resolveSku('F287760', undefined, 120, [pk, tulip])
    expect(r.match?.sku).toBe('F287760- FLOWER')
    expect(r.basis).toBe('variant+pack')
  })

  it('will not pick between variants when none agrees on pack size', () => {
    const pk = row({ sku: 'F287760- Pk', sales_desc: '24/cs' })
    const tulip = row({ sku: 'F287760- FLOWER', sales_desc: '120 pcs/cs' })
    expect(resolveSku('F287760', undefined, 36, [pk, tulip]).problem).toBe('ambiguous')
  })

  it('reports missing only when there is no exact record and no variant', () => {
    expect(resolveSku('CM072601', undefined, 120, []).problem).toBe('missing')
  })

  it('uses pack size to break an otherwise ambiguous duplicate', () => {
    const a = row({ sku: 'B324045', full_name: 'Backpack:B324045', sales_desc: 'a - 12/cs', is_active: true })
    const b = row({ sku: 'B324045', full_name: 'B324045', sales_desc: 'b - 48/cs', is_active: true })
    expect(resolveSku('B324045', [a, b], 48).match?.sales_desc).toContain('b -')
  })
})

describe('parsePackSize', () => {
  it('reads the common shapes', () => {
    expect(parsePackSize('White Heart Triple Set Fuzzy-24pcs/cs')).toBe(24)
    expect(parsePackSize('Chenille Stems Gerbera Daisies - 120 pcs/cs - 20" x 10"')).toBe(120)
    expect(parsePackSize('Pig Weighted Paw Calm-Panion Plush - 24inch - 12/cs - 24x17x19')).toBe(12)
  })

  it('returns null when there is no pack to read', () => {
    expect(parsePackSize('Just a product name')).toBeNull()
    expect(parsePackSize(null)).toBeNull()
  })
})
