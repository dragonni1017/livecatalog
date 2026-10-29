import type { getAdminClient } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { ilikeExact } from '@/lib/order-access'
import { loadRepAccounts } from '@/lib/rep-accounts'
import { chooseAutoOwner, type PreviousOrder } from '@/lib/order-owner'

type Db = ReturnType<typeof getAdminClient>

// Gives a just-saved order an owner (lib/order-owner.ts chooseAutoOwner).
// Runs AFTER the order is committed, as its own update, from the order
// submission's side-effect step: it must never fail or slow the order
// itself, so every error is caught and only logged. An order that already
// has an owner is left alone, and the update re-checks that in its WHERE
// clause in case an admin assigned one in the meantime.
export async function autoAssignOrder(db: Db, orderId: string): Promise<void> {
  try {
    const { data: order, error } = await db
      .from('order_requests')
      .select('id, reference_code, customer_email, placed_by_rep, rep_user_id, assigned_rep_email')
      .eq('id', orderId)
      .maybeSingle()
    if (error || !order || order.assigned_rep_email) return

    const reps = await loadRepAccounts(db)
    if (reps.length === 0) return

    let previous: PreviousOrder[] = []
    if (order.customer_email) {
      const { data } = await db
        .from('order_requests')
        .select('created_at, placed_by_rep, rep_user_id, assigned_rep_email')
        .ilike('customer_email', ilikeExact(order.customer_email))
        .neq('id', orderId)
        .order('created_at', { ascending: false })
        .limit(20)
      previous = (data ?? []) as PreviousOrder[]
    }

    const owner = chooseAutoOwner(order, previous, reps)
    if (!owner.email) return

    const { data: rows, error: updateError } = await db
      .from('order_requests')
      .update({ assigned_rep_email: owner.email, assigned_at: new Date().toISOString() })
      .eq('id', orderId)
      .is('assigned_rep_email', null)
      .select('id')
    if (updateError) throw updateError
    if (!rows?.length) return

    await logAudit({
      action: 'order_owner_auto',
      entity_type: 'order',
      entity_id: orderId,
      entity_label: order.reference_code,
      new_value: owner.email,
      performed_by: `auto (${owner.why})`,
    })
  } catch (err) {
    console.error('[orders] auto-assign failed (order still saved):', err)
  }
}
