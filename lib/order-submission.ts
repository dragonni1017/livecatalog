/**
 * Shared order-build/insert core, used by both the public order path
 * (app/api/orders/route.ts) and the rep order path (app/rep/api/orders/route.ts)
 * so the two never independently drift on how a price/discount gets computed
 * and persisted — this is a security-sensitive path (discount math).
 */
import { getAdminClient } from '@/lib/supabase'
import { getEffectivePrice, type VolumeTier } from '@/lib/order-rules'
import type { IncomingItem } from '@/lib/order-validation'
import type { CheckoutContact } from '@/lib/types'

type Db = ReturnType<typeof getAdminClient>

export interface LineItem {
  product_id: string
  sku: string
  name: string
  unit_price_cents: number
  qty: number
  line_total_cents: number
}

// ── 1. Re-fetch authoritative product data and build line items ────────────
// Never trust client-submitted prices. Volume-tier pricing (per-SKU qty
// breaks) is applied here; any further discount (customer file % or rep
// tier %) is layered on top by the caller.
export async function buildLineItems(
  db: Db,
  items: IncomingItem[],
): Promise<{ lineItems: LineItem[]; outOfStock: string[]; error?: undefined } | { error: string }> {
  const { data: products, error: prodErr } = await db
    .from('products')
    .select('id, sku, name, price_cents, stock_qty, is_active, manually_hidden, volume_tiers')
    .in('id', items.map((i) => i.productId))

  if (prodErr) {
    console.error('[order-submission] product lookup failed:', prodErr.message)
    return { error: 'Could not validate cart. Please try again.' }
  }

  const byId = new Map((products ?? []).map((p) => [p.id, p]))
  const lineItems: LineItem[] = []
  const outOfStock: string[] = []

  for (const item of items) {
    const p = byId.get(item.productId)
    if (!p || !p.is_active || p.manually_hidden) continue
    if (p.stock_qty < item.qty) {
      outOfStock.push(`${p.sku} (${p.name}) — ${p.stock_qty} in stock, ${item.qty} requested`)
    }
    const unitPrice = getEffectivePrice(p.price_cents, item.qty, p.volume_tiers as VolumeTier[] | null)
    lineItems.push({
      product_id: p.id, sku: p.sku, name: p.name,
      unit_price_cents: unitPrice, qty: item.qty,
      line_total_cents: unitPrice * item.qty,
    })
  }

  return { lineItems, outOfStock }
}

// ── 2. Reference code ────────────────────────────────────────────────────
// ORD-<year>-<4-digit sequence>. Sequence derived from this year's order
// count. The reference_code unique constraint guards against concurrent
// collisions; the caller retries with the next number on a 23505 violation.
export async function nextReferenceCode(db: Db, attempt: number): Promise<string> {
  const year = new Date().getFullYear()
  const { count } = await db
    .from('order_requests')
    .select('id', { count: 'exact', head: true })
    .like('reference_code', `ORD-${year}-%`)
  const seq = (count ?? 0) + 1 + attempt
  return `ORD-${year}-${String(seq).padStart(4, '0')}`
}

// ── 3. Atomically insert order + items via the submit_order() RPC ──────────
export interface InsertOrderArgs {
  db: Db
  contact: CheckoutContact
  lineItems: LineItem[]
  subtotalCents: number
  repUserId?: string | null
  appliedTierCode?: string | null
  appliedTierDiscountPercent?: number | null
}

export type InsertOrderResult =
  | { ok: true; orderId: string; referenceCode: string }
  | { ok: false; error: string; status: number }

export async function insertOrder(args: InsertOrderArgs): Promise<InsertOrderResult> {
  const { db, contact, lineItems, subtotalCents, repUserId, appliedTierCode, appliedTierDiscountPercent } = args

  let orderId: string | null = null
  let referenceCode = ''
  for (let attempt = 0; attempt < 3 && !orderId; attempt++) {
    referenceCode = await nextReferenceCode(db, attempt)
    const { data, error } = await db.rpc('submit_order', {
      p_reference_code:                referenceCode,
      p_customer_name:                 contact.name.trim(),
      p_customer_email:                contact.email.trim().toLowerCase(),
      p_customer_phone:                contact.phone?.trim() || null,
      p_customer_company:              contact.company?.trim() || null,
      p_notes:                         contact.notes?.trim() || null,
      p_subtotal_cents:                subtotalCents,
      p_placed_by_rep:                 contact.placedByRep?.trim() || null,
      p_po_number:                     contact.poNumber?.trim() || null,
      p_items:                         lineItems,
      p_rep_user_id:                   repUserId ?? null,
      p_applied_tier_code:             appliedTierCode ?? null,
      p_applied_tier_discount_percent: appliedTierDiscountPercent ?? null,
    })
    if (!error) {
      orderId = data as string
    } else if (error.code === '23505') {
      continue // duplicate reference_code — retry with next number
    } else {
      console.error('[order-submission] submit_order rpc failed:', error.message)
      return { ok: false, error: 'Could not submit your request. Please try again.', status: 500 }
    }
  }

  if (!orderId) {
    return { ok: false, error: 'Could not generate an order reference. Please try again.', status: 500 }
  }

  return { ok: true, orderId, referenceCode }
}
