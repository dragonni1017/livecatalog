import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ isSmtpConfigured: () => true, sendMail }))

import { checkBackInStockAndNotify } from '@/lib/back-in-stock-notify'

const product = (over: Record<string, unknown>) => ({
  name: 'Thing', sku: 'T1', stock_qty: 10, is_active: true, manually_hidden: false, ...over,
})

// select/is on back_in_stock_requests, update/eq to mark notified.
function fakeDb(requests: { id: string; product: unknown }[]) {
  const marked: string[] = []
  const db = {
    from: () => ({
      select: () => ({
        is: async () => ({
          data: requests.map((r) => ({ email: `${r.id}@example.com`, product_id: `p-${r.id}`, ...r })),
          error: null,
        }),
      }),
      update: () => ({
        eq: async (_col: string, id: string) => {
          marked.push(id)
          return { error: null }
        },
      }),
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, marked }
}

beforeEach(() => {
  sendMail.mockClear()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('checkBackInStockAndNotify', () => {
  it('only emails for products that are in stock and shown on the storefront', async () => {
    const { db, marked } = fakeDb([
      { id: 'shown', product: product({}) },
      { id: 'hidden', product: product({ manually_hidden: true }) },
      { id: 'inactive', product: product({ is_active: false }) },
      { id: 'soldout', product: product({ stock_qty: 0 }) },
      { id: 'gone', product: null },
    ])
    expect(await checkBackInStockAndNotify(db)).toEqual({ notified: 1 })
    expect(sendMail).toHaveBeenCalledOnce()
    // the rest stay pending, so they're emailed once shown and in stock
    expect(marked).toEqual(['shown'])
  })
})
