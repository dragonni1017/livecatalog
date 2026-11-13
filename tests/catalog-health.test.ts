import { describe, expect, it } from 'vitest'
import {
  classifyPhoto, dropTypingPrefixes, heldPricesCheck, looksLikeCode, lowStockEmailCheck, priceDisplayCheck,
  staleReviewCheck, summarizeSearches, syncCheck, visibleProductsCheck, type VisibleProduct,
} from '@/lib/catalog-health'

const prod = (over: Partial<VisibleProduct>): VisibleProduct => ({ id: 'p', sku: 'S', name: 'N', price_cents: 300, image_url: 'https://x/y.jpg', needs_photo: false, ...over })

describe('visibleProductsCheck', () => {
  it('is a problem for a visible product without a price or photo', () => {
    const c = visibleProductsCheck([prod({}), prod({ id: 'a', price_cents: 0 }), prod({ id: 'b', image_url: '' })])
    expect(c.level).toBe('problem')
    expect(c.items?.map((i) => i.detail)).toEqual(['no price', 'no photo'])
  })
  it('only asks for a look when some are flagged "needs photo"', () => {
    expect(visibleProductsCheck([prod({ needs_photo: true })]).level).toBe('look')
    expect(visibleProductsCheck([prod({})]).level).toBe('ok')
  })
})

describe('syncCheck', () => {
  const now = Date.parse('2026-11-13T12:00:00Z')
  const run = { started_at: '2026-11-13T08:32:00Z', status: 'ok', updated: 3215, error_count: 0, details: null }
  it('is OK for a clean run this morning', () => expect(syncCheck(run, now).level).toBe('ok'))
  it('is a problem when late, failed or with errors', () => {
    expect(syncCheck({ ...run, started_at: '2026-11-12T08:32:00Z' }, now + 7 * 3_600_000).level).toBe('problem')
    expect(syncCheck({ ...run, status: 'error' }, now).level).toBe('problem')
    expect(syncCheck({ ...run, error_count: 2 }, now).level).toBe('problem')
    expect(syncCheck(null, now).level).toBe('problem')
  })
})

describe('lowStockEmailCheck', () => {
  it('flags a switch that can do nothing because no recipient is set', () => {
    expect(lowStockEmailCheck({ switchOn: true, recipientSet: false, lastResult: null }).level).toBe('problem')
    expect(lowStockEmailCheck({ switchOn: false, recipientSet: false, lastResult: null }).level).toBe('look')
    expect(lowStockEmailCheck({ switchOn: false, recipientSet: true, lastResult: null }).level).toBe('ok')
  })
})

describe('small checks', () => {
  it('price display, held prices, review queue', () => {
    expect(priceDisplayCheck(true, true).level).toBe('ok')
    expect(priceDisplayCheck(false, false).summary).toContain('listings and product pages')
    expect(heldPricesCheck(389).link?.href).toBe('/admin/api/price-review/erply')
    expect(heldPricesCheck(0).level).toBe('ok')
    const r = staleReviewCheck([
      { sku: 'A', suggested_cents: 4325, live_cents: 4325 },
      { sku: 'B', suggested_cents: 6000, live_cents: 300 },
      { sku: 'C', suggested_cents: null, live_cents: 300 },
    ])
    expect(r.level).toBe('look')
    expect(r.items?.map((i) => i.label)).toEqual(['A'])
    expect(r.summary).toContain('2 need a decision')
  })
})

describe('searches', () => {
  it('folds partial words logged while typing into the full search', () => {
    expect(dropTypingPrefixes(['plush sup', 'plush supe', 'plush supei', 'ribbon', 'rib']).sort()).toEqual(['plush supei', 'ribbon'])
  })
  it('recognises product codes and barcodes, not words', () => {
    for (const t of ['P273847', 'f287994', '3D801303', 'P273815-60cm', '737879112809']) expect(looksLikeCode(t)).toBe(true)
    for (const t of ['ribbon', 'i < you', '3d skeleton', '12']) expect(looksLikeCode(t)).toBe(false)
  })
  it('splits codes into not-in-catalog and hidden', () => {
    const where: Record<string, 'visible' | 'hidden' | 'inactive'> = { d701137: 'hidden', f287541: 'visible' }
    const ev = (t: string) => ({ term: `[no_results] ${t}`, created_at: '2026-11-12' })
    const s = summarizeSearches([ev('P273847'), ev('P273847'), ev('D701137'), ev('F287541'), ev('bunies'), ev('buni')], 50, { get: (c) => where[c] })
    expect(s.missingCodes).toEqual([{ term: 'p273847', times: 2 }])
    expect(s.hiddenCodes).toEqual([{ term: 'd701137', times: 1 }])
    expect(s.topTerms).toEqual([{ term: 'bunies', times: 1 }])
    expect(s.zero).toBe(6)
  })
})

describe('classifyPhoto', () => {
  it('sorts loads, failures and thumbnails', () => {
    expect(classifyPhoto({ ok: true, status: 200, contentType: 'image/jpeg', bytes: 48_000 })).toBe('ok')
    expect(classifyPhoto({ ok: true, status: 200, contentType: 'image/jpeg', bytes: 1153 })).toBe('tiny')
    expect(classifyPhoto({ ok: true, status: 200, contentType: 'image/jpeg', bytes: 0 })).toBe('ok')
    expect(classifyPhoto({ ok: false, status: 404, contentType: 'text/html', bytes: 0 })).toBe('broken')
    expect(classifyPhoto({ ok: true, status: 200, contentType: 'text/html', bytes: 900 })).toBe('broken')
  })
})
