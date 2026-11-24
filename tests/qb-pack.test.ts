import { describe, expect, it } from 'vitest'
import { soldByFromQbDesc } from '@/lib/qb-pack'

describe('soldByFromQbDesc', () => {
  it('reads packs per case as pack-sold', () => {
    expect(soldByFromQbDesc('White Heartfelt Love Floral Paper - 60 pks/cs\n24" x 13" x 6" - 37 lbs')).toBe('pack')
    expect(soldByFromQbDesc("Gift Bow - 20/pk - 150 pk's/cs")).toBe('pack')
  })

  it('leaves piece counts and silence to the default', () => {
    expect(soldByFromQbDesc('Single Colored Roses - 144/cs - 25" x 12" x 13" - 10lbs')).toBeNull()
    expect(soldByFromQbDesc('Foam Bear - 12/pk - 10pk/cs - 120 pcs/cs')).toBeNull()
    expect(soldByFromQbDesc('16bx/cs')).toBeNull()
    expect(soldByFromQbDesc(null)).toBeNull()
  })
})
