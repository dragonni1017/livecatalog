import { describe, expect, it } from 'vitest'
import { showsQuoteBar } from '@/components/catalog/MobileQuoteBar'
import { searchTerms } from '@/lib/search-terms'

describe('showsQuoteBar', () => {
  it('shows while browsing', () => {
    for (const p of ['/', '/product/prod-00706', '/new-arrivals', '/best-sellers', '/collections/x', '/favorites']) expect(showsQuoteBar(p)).toBe(true)
  })
  it('stays off the quote, order, account and form pages', () => {
    for (const p of ['/cart', '/order/ORD-2026-0001', '/account', '/login', '/register', '/quick-order', '/credit-application', '/my-orders', '/productx']) expect(showsQuoteBar(p)).toBe(false)
  })
})

describe('Spanish synonyms from the Nov 6-9 searches', () => {
  it('maps seda and platos', () => {
    expect(searchTerms('seda')).toContain('tissue')
    expect(searchTerms('platos')).toContain('plate')
  })
})
