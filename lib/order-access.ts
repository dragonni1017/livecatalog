import type { User } from '@supabase/supabase-js'
import { safeEqual } from '@/lib/request-auth'

// Who may see /order/<reference> or post /api/order-reply for an order.
// Reference codes are sequential and guessable, so the reference alone is
// never enough (migration 0053). Any ONE of these grants access.
export interface OrderAccessFields {
  access_token: string | null
  customer_email: string | null
  rep_user_id: string | null
}

export function canAccessOrder(
  order: OrderAccessFields,
  opts: { token?: string | null; user?: User | null },
): boolean {
  const { token, user } = opts

  // 1. The link from the customer's email.
  if (token && order.access_token && safeEqual(token, order.access_token)) return true

  if (!user) return false
  const role = user.app_metadata?.role

  // 2. Admins see every order (the admin order screen links here).
  if (role === 'admin') return true

  // 3. The rep who placed it.
  if (role === 'rep' && order.rep_user_id && order.rep_user_id === user.id) return true

  // 4. The customer, signed in with the order's email. This is how
  //    /account and /my-orders link here.
  const a = user.email?.trim().toLowerCase()
  const b = order.customer_email?.trim().toLowerCase()
  return !!a && !!b && a === b
}

/** The customer-facing link for an order, token included. */
export function orderUrl(referenceCode: string, accessToken: string | null): string {
  const base = `https://lyusa.app/order/${encodeURIComponent(referenceCode)}`
  return accessToken ? `${base}?t=${encodeURIComponent(accessToken)}` : base
}

/**
 * An email as an exact, case-insensitive ILIKE pattern. `_` and `%` are
 * wildcards in LIKE, and `_` is common in addresses, so an unescaped
 * `.ilike('customer_email', 'a_b@x.com')` also matched `aXb@x.com` and showed
 * that customer's orders.
 */
export function ilikeExact(value: string): string {
  return value.replace(/[\\%_]/g, (c) => '\\' + c)
}
