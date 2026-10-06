import { describe, expect, it } from 'vitest'
import { descriptorFromQbDesc } from '@/lib/qb-descriptor'

const head = (desc: string, sku = '') => descriptorFromQbDesc(desc, sku).head

describe('descriptorFromQbDesc', () => {
  // Real QuickBooks descriptions whose raw text became live product names on
  // 2026-09-23 (data/broken-product-names-20261006.csv).
  it('strips the carton and case pack that leaked into names', () => {
    expect(head('Yellow Sunflower Butterfly Paper - 60pk/cs - 25" x 13" x 6" - 40lbs')).toBe('Yellow Sunflower Butterfly Paper')
    expect(head('Clear Heart Flower Holder - 84/cs - 27" x 23" x 22" - 48lbs')).toBe('Clear Heart Flower Holder')
    expect(head('SeaCreature Keychain - 240/cs - 12" x 8" x 12" - 17lbs')).toBe('SeaCreature Keychain')
    expect(head('25cm Dumpling Bun Squish Toy - 8/cs - 23" x 23" x 15" - 44lbs')).toBe('25cm Dumpling Bun Squish Toy')
  })

  it('handles unitless house-pattern cartons and full pack lines', () => {
    expect(head('Kappy Fur Pen Giant 12pcs/bx 24bx/cs 288/cs 25x25x25 42lbs')).toBe('Kappy Fur Pen Giant')
    expect(head('Furry Food Notebook - 16pcs/bx 3bx/cs 48/cs 19x18x21 29lbs')).toBe('Furry Food Notebook')
    // QuickBooks stores a line break here (the plan CSV shows it as " / ").
    expect(head("Pink Floral Tissue - 150 pk's/cs\n13\" x 13\" x 12\" - 22 lbs")).toBe('Pink Floral Tissue')
    expect(head('White with Pink Flower Paper - 20/pk - 60pk/cs')).toBe('White with Pink Flower Paper')
  })

  it('reports whether carton text was present', () => {
    expect(descriptorFromQbDesc('Silver Crown - 240/cs - 20" x 16" x 13" - 34lbs').hadCarton).toBe(true)
    expect(descriptorFromQbDesc('Boba Keychain - 40pc/cs').hadCarton).toBe(false)
  })

  it('keeps counted styles, sizes and existing capitals', () => {
    expect(head('4 Style Plush Cup - 240/cs')).toBe('4 Style Plush Cup')
    expect(head('Corgi Companion Plush-60cm 12/cs')).toBe('Corgi Companion Plush 60cm')
    expect(head('Best MOM Ever Tumbler - 20/cs')).toBe('Best MOM Ever Tumbler')
    expect(head('crown with blue jewel - 240/cs')).toBe('Crown with Blue Jewel')
  })

  it('takes a size from the SKU suffix only when the description has none', () => {
    const r = descriptorFromQbDesc('Lamb Plush - 24/cs', 'P273833-30cm')
    expect(r.head).toBe('Lamb Plush 30cm')
    expect(r.sizeFromSku).toBe('30cm')
    expect(descriptorFromQbDesc('Duck Plush 30cm - 24/cs', 'P273838-30cm').sizeFromSku).toBeNull()
  })

  it('returns an empty head when nothing but pack and carton text is left', () => {
    expect(head('240/cs - 20" x 16" x 12" - 30lbs')).toBe('')
  })
})
