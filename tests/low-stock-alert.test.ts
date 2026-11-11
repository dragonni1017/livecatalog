import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ isEmailConfigured: () => true, sendMail }))

import { checkLowStockAndNotify } from '@/lib/low-stock-alert'
import { isLowStockEmailEnabled } from '@/lib/alert-settings'

// Just enough of supabase-js for these two modules: select/eq/maybeSingle
// on alert_settings, select/eq on products, update/in on products.
function fakeDb(setting: { data?: unknown; error?: unknown }) {
  const updates: { values: Record<string, unknown>; skus: string[] }[] = []
  const products = [
    { sku: 'LOW', name: 'Low one', stock_qty: 2, low_stock_threshold: null, low_stock_alerted: false },
    { sku: 'OK', name: 'Fine', stock_qty: 50, low_stock_threshold: null, low_stock_alerted: false },
  ]
  const db = {
    from(table: string) {
      if (table === 'alert_settings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null, ...setting }) }) }) }
      }
      return {
        select: () => ({ eq: async () => ({ data: products, error: null }) }),
        update: (values: Record<string, unknown>) => ({
          in: async (_col: string, skus: string[]) => {
            updates.push({ values, skus })
            return { error: null }
          },
        }),
      }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, updates }
}

beforeEach(() => {
  sendMail.mockClear()
  process.env.REORDER_ALERT_TO = 'alerts@example.com'
})

describe('low-stock email switch', () => {
  it('sends when the switch is on', async () => {
    const { db, updates } = fakeDb({ data: { low_stock_email_enabled: true } })
    expect(await checkLowStockAndNotify(db)).toEqual({ alerted: 1 })
    expect(sendMail).toHaveBeenCalledOnce()
    expect(updates).toEqual([{ values: expect.objectContaining({ low_stock_alerted: true }), skus: ['LOW'] }])
  })

  it('sends nothing when off, but still marks products alerted', async () => {
    const { db, updates } = fakeDb({ data: { low_stock_email_enabled: false } })
    expect(await checkLowStockAndNotify(db)).toEqual({ alerted: 0, emailOff: true })
    expect(sendMail).not.toHaveBeenCalled()
    expect(updates).toEqual([{ values: expect.objectContaining({ low_stock_alerted: true }), skus: ['LOW'] }])
  })

  it('treats a missing row or a failed read as on', async () => {
    expect(await isLowStockEmailEnabled(fakeDb({ data: null }).db)).toBe(true)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await isLowStockEmailEnabled(fakeDb({ error: { message: 'PGRST205' } }).db)).toBe(true)
    errSpy.mockRestore()
  })
})
