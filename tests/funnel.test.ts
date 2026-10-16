import { describe, expect, it } from 'vitest'
import { summarizeFunnel, type FunnelEvent } from '../lib/funnel'

const e = (visitor_id: string, type: string, source: string | null = null): FunnelEvent => ({ visitor_id, type, source })

describe('summarizeFunnel', () => {
  const rows = [
    e('a', 'view', 'qr'), // a scanned, added, opened, submitted
    e('a', 'add_to_cart'),
    e('a', 'cart_view'),
    e('a', 'quote_submitted'),
    e('b', 'view', 'qr'), // b scanned twice, added only
    e('b', 'view', 'qr'),
    e('b', 'add_to_cart'),
    e('c', 'view'), // c browsed normally and submitted
    e('c', 'add_to_cart'),
    e('c', 'cart_view'),
    e('c', 'quote_submitted'),
    e('d', 'search'),
    e('e', 'add_to_cart', 'qr'), // a source on a non-view event isn't a scan
  ]
  const { steps, qr } = summarizeFunnel(rows)

  it('counts distinct visitors per step', () => {
    expect(steps.map((s) => s.visitors)).toEqual([5, 4, 2, 2])
  })
  it('QR: scans are tagged views; visitors are distinct', () => {
    expect(qr.scans).toBe(3)
    expect(qr.visitors).toBe(2)
  })
  it('QR: only scanners count toward the QR follow-through', () => {
    expect(qr).toMatchObject({ addedToCart: 2, openedCart: 1, submittedQuote: 1 })
  })
  it('empty input', () => {
    expect(summarizeFunnel([])).toEqual({
      steps: [
        { label: 'Visited (viewed, searched or used the cart)', visitors: 0 },
        { label: 'Added to cart', visitors: 0 },
        { label: 'Opened cart', visitors: 0 },
        { label: 'Submitted a quote', visitors: 0 },
      ],
      qr: { scans: 0, visitors: 0, addedToCart: 0, openedCart: 0, submittedQuote: 0 },
    })
  })
})
