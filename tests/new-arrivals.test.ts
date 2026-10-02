import { describe, expect, it } from 'vitest'
import { latestArrivalBySku } from '@/lib/new-arrivals'

const since = Date.parse('2026-09-02T00:00:00Z')

describe('latestArrivalBySku', () => {
  const shipments = [
    { id: 'old', status: 'applied', applied_at: '2026-08-01T00:00:00Z' },
    { id: 'a', status: 'applied', applied_at: '2026-09-23T10:00:00Z' },
    { id: 'b', status: 'applied', applied_at: '2026-09-28T10:00:00Z' },
    { id: 'staged', status: 'staged', applied_at: null },
    { id: 'gone', status: 'abandoned', applied_at: '2026-09-25T10:00:00Z' },
  ]

  it('dates each SKU by its most recent applied shipment in the window', () => {
    const m = latestArrivalBySku(
      shipments,
      [
        { shipment_id: 'a', sku: 'K229582', qty_received: 10 },
        { shipment_id: 'b', sku: 'K229582', qty_received: 5 }, // spans two containers
        { shipment_id: 'a', sku: 'F288091', qty_received: 3 },
      ],
      since,
    )
    expect(m.get('K229582')).toBe('2026-09-28T10:00:00Z')
    expect(m.get('F288091')).toBe('2026-09-23T10:00:00Z')
  })

  it('ignores old, staged and abandoned shipments, and lines that received nothing', () => {
    const m = latestArrivalBySku(
      shipments,
      [
        { shipment_id: 'old', sku: 'OLD', qty_received: 10 },
        { shipment_id: 'staged', sku: 'STAGED', qty_received: 10 },
        { shipment_id: 'gone', sku: 'GONE', qty_received: 10 },
        { shipment_id: 'a', sku: 'ZERO', qty_received: 0 },
      ],
      since,
    )
    expect([...m.keys()]).toEqual([])
  })
})
