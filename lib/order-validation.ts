import { meetsOrderMinimum, MIN_ORDER_SUBTOTAL_CENTS, formatPriceCents } from '@/lib/order-rules'
import type { CheckoutContact } from '@/lib/types'

export interface IncomingItem {
  productId: string
  qty: number
}

type Valid = { ok: true; contact: CheckoutContact; items: IncomingItem[] }
type Invalid = { ok: false; error: string; status: number }
export type OrderInputResult = Valid | Invalid

// Django form-validation pattern: validate and clean all input before touching the DB.
// Returns typed clean data on success, or a structured error on failure.
export function validateOrderInput(body: unknown): OrderInputResult {
  const b = (body ?? {}) as Record<string, unknown>
  const contact = (b.contact ?? {}) as CheckoutContact
  const rawItems = Array.isArray(b.items) ? (b.items as IncomingItem[]) : []

  if (!contact.name?.trim() || !contact.email?.trim()) {
    return { ok: false, error: 'Name and email are required.', status: 400 }
  }

  const items = rawItems.filter(
    (i) => i?.productId && Number.isFinite(i.qty) && i.qty > 0,
  )
  if (items.length === 0) {
    return { ok: false, error: 'Your cart is empty.', status: 400 }
  }

  return { ok: true, contact, items }
}

export function validateOrderMinimum(subtotalCents: number): Invalid | null {
  if (!meetsOrderMinimum(subtotalCents)) {
    return {
      ok: false,
      error: `Minimum order is ${formatPriceCents(MIN_ORDER_SUBTOTAL_CENTS)}. Add more items to submit.`,
      status: 400,
    }
  }
  return null
}
