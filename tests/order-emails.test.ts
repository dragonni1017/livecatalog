import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ isSmtpConfigured: () => true, sendMail }))

import { notifyCustomer } from '@/lib/order-emails'
import { SHIPPING_NOTE } from '@/lib/order-rules'

beforeEach(() => sendMail.mockClear())

describe('notifyCustomer', () => {
  it('tells the customer shipping is billed separately, after the subtotal', async () => {
    await notifyCustomer({
      referenceCode: 'ORD-2026-0001',
      accessToken: 'tok',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contact: { name: 'Jane', email: 'jane@example.com' } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lineItems: [{ qty: 2, name: 'Widget', sku: 'W1', unit_price_cents: 250, line_total_cents: 500 }] as any,
      subtotalCents: 500,
    })
    const { text } = (sendMail.mock.calls[0] as unknown as [{ text: string }])[0]
    expect(text).toContain(`Subtotal: $5.00\n${SHIPPING_NOTE}\n`)
  })
})
