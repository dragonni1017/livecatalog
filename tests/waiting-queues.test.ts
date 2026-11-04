import { describe, expect, it } from 'vitest'
import { buildWaitingQueues, type WaitingInput } from '@/lib/waiting-queues'

const NOW = '2026-11-04T20:00:00Z' // a Wednesday
const empty: WaitingInput = {
  nowIso: NOW,
  quotesToAnswer: [],
  ordersForQuickBooks: [],
  creditApplications: [],
  resaleCertificates: [],
  stagedShipments: [],
  caseCounts: [],
  names: [],
  prices: [],
  pricesForErply: 0,
  hiddenSearched: [],
  photosToTake: 0,
}

describe('buildWaitingQueues', () => {
  it('lists only queues with something waiting', () => {
    expect(buildWaitingQueues(empty)).toEqual([])
    const q = buildWaitingQueues({ ...empty, names: ['2026-11-04T18:00:00Z'] })
    expect(q.map((x) => [x.key, x.who, x.countText, x.age?.text, x.href])).toEqual([
      ['names', 'Owner', '1 rename', 'added today', '/admin/name-review'],
    ])
  })

  it('leaves out a queue that failed to load (null) instead of showing zero', () => {
    const q = buildWaitingQueues({ ...empty, prices: null, pricesForErply: null, hiddenSearched: null, photosToTake: null, quotesToAnswer: ['2026-11-04T18:00:00Z'] })
    expect(q.map((x) => x.key)).toEqual(['quotes'])
  })

  it('orders stale first, then longest waiting, then biggest', () => {
    const q = buildWaitingQueues({
      ...empty,
      names: Array(120).fill('2026-10-29T20:00:00Z'), // 6 days, 4 business days: not stale
      caseCounts: ['2026-10-27T20:00:00Z'], // 8 days, stale
      prices: Array(82).fill('2026-10-29T20:00:00Z'),
      photosToTake: 796, // no age
      pricesForErply: 192,
    })
    expect(q.map((x) => x.key)).toEqual(['case-counts', 'names', 'prices', 'photos', 'erply'])
    expect(q[0].age).toMatchObject({ stale: true, days: 8 })
  })

  it('words the count-only and last-seen queues', () => {
    const q = buildWaitingQueues({ ...empty, pricesForErply: 1, hiddenSearched: ['2026-10-01T00:00:00Z', '2026-11-03T18:00:00Z'], photosToTake: 2 })
    const by = new Map(q.map((x) => [x.key, x]))
    expect(by.get('erply')).toMatchObject({ who: 'Price setter', countText: '1 price', age: null })
    expect(by.get('hidden')).toMatchObject({ who: 'Owner', countText: '2 products', note: 'last searched yesterday', href: '/admin/zero-results#hidden' })
    expect(by.get('photos')).toMatchObject({ who: 'Photos', countText: '2 products', href: '/admin/photo-shot-list' })
  })
})
