import { describe, expect, it } from 'vitest'
import { catalogCategoryFor, erplyGroupForCategory } from '@/lib/catalog-erply-group'

const groups = [
  { id: 1, name: 'Drinkware' },
  { id: 2, name: 'Drinkware / Tumblers' },
  { id: 3, name: 'Florals/Gifts' },
  { id: 4, name: 'Florals/Gifts / Papers' },
  { id: 5, name: 'Floral Papers' },
  { id: 6, name: 'Toys' },
  { id: 7, name: 'Toys / Plush Toys' },
  { id: 8, name: 'Toys / Bubbles' },
  { id: 9, name: 'LED/Electronics' },
  { id: 10, name: 'LED/Electronics / Lamps' },
  { id: 11, name: 'Gift Boxes' },
]

describe('erplyGroupForCategory', () => {
  it('finds the group whose leaf aliases onto the category', () => {
    expect(erplyGroupForCategory('Papers', groups)?.name).toBe('Florals/Gifts / Papers')
    expect(erplyGroupForCategory('Plush', groups)?.name).toBe('Toys / Plush Toys')
  })

  it('uses the overrides for many-to-one and carved-out categories', () => {
    expect(erplyGroupForCategory('Drinkware & Cups', groups)?.name).toBe('Drinkware / Tumblers')
    expect(erplyGroupForCategory('Toys & Novelties', groups)?.name).toBe('Toys')
    expect(erplyGroupForCategory('Humidifier', groups)?.name).toBe('LED/Electronics / Lamps')
    expect(erplyGroupForCategory('Gifts', groups)?.name).toBe('Gift Boxes')
  })

  it('returns null when nothing matches', () => {
    expect(erplyGroupForCategory('Signs/Animals', groups)).toBeNull()
  })
})

describe('catalogCategoryFor', () => {
  const names = ['Papers', 'Plush', 'Toys & Novelties']
  it('keeps a catalog name and converts a legacy Erply group label', () => {
    expect(catalogCategoryFor('papers', names)).toBe('Papers')
    expect(catalogCategoryFor('Florals/Gifts / Papers', names)).toBe('Papers')
    expect(catalogCategoryFor('Toys / Plush Toys', names)).toBe('Plush')
    expect(catalogCategoryFor('Toys / Bubbles', names)).toBe('Toys & Novelties')
    expect(catalogCategoryFor('Floral Papers', names)).toBeNull()
    expect(catalogCategoryFor(null, names)).toBeNull()
  })
})
