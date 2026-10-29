import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { parseReviewBody } from '@/lib/price-review'

// Lives under /admin, so middleware.ts already requires the admin login.
//
// POST /admin/api/price-review
//   { id, action: 'approve', cents }  set the website price and hold it (0068)
//   { id, action: 'skip' }            leave the price alone
//   { id, action: 'reopen' }          put a skipped row back to pending
//
// Approve writes the audit_log row FIRST (a failure there stops the change),
// then sets price_cents and held_price_cents together, so the Erply sync keeps
// the price until someone enters the same price in Erply.

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const req = parseReviewBody(body)
  if ('error' in req) return NextResponse.json({ error: req.error }, { status: 400 })
  if (isMockMode()) return NextResponse.json({ ok: true, mock: true })

  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const { data: item, error: itemErr } = await db
      .from('price_review_items')
      .select('id, batch, product_id, sku, status')
      .eq('id', req.id)
      .maybeSingle()
    if (itemErr) throw itemErr
    if (!item) return NextResponse.json({ error: 'Row not found' }, { status: 404 })

    if (req.action === 'reopen') {
      if (item.status !== 'skipped') return NextResponse.json({ error: 'Only a skipped row can be reopened.' }, { status: 409 })
      const { error } = await db.from('price_review_items').update({ status: 'pending', decided_at: null }).eq('id', item.id).eq('status', 'skipped')
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (item.status !== 'pending') return NextResponse.json({ error: 'This row was already decided. Reload the page.' }, { status: 409 })

    if (req.action === 'skip') {
      const { error } = await db
        .from('price_review_items')
        .update({ status: 'skipped', decided_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('status', 'pending')
      if (error) throw error
      await logAudit({ action: 'price_review_skipped', entity_type: 'product', entity_id: item.product_id, entity_label: item.sku, new_value: item.batch })
      return NextResponse.json({ ok: true })
    }

    // Approve.
    const { data: product, error: prodErr } = await db
      .from('products')
      .select('id, sku, name, price_cents, held_price_cents')
      .eq('id', item.product_id)
      .maybeSingle()
    if (prodErr) throw prodErr
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const markApproved = () =>
      db
        .from('price_review_items')
        .update({ status: 'approved', decided_cents: req.cents, decided_at: new Date().toISOString() })
        .eq('id', item.id)

    // Already at exactly this price and hold (an earlier approve whose row
    // wasn't marked, or a price held by an earlier run): just mark the row.
    // No second audit row, no second write.
    if (product.price_cents === req.cents && product.held_price_cents === req.cents) {
      const { error } = await markApproved()
      if (error) throw error
      return NextResponse.json({ ok: true, alreadyApplied: true })
    }

    const { error: auditErr } = await db.from('audit_log').insert({
      action: 'product_price_held',
      entity_type: 'product',
      entity_id: product.id,
      entity_label: `${product.name} (${product.sku})`,
      old_value: String(product.price_cents),
      new_value: String(req.cents),
      performed_by: `admin: price review ${item.batch}, held until Erply matches; written before apply`,
    })
    if (auditErr) throw auditErr

    const { data: updated, error: updErr } = await db
      .from('products')
      .update({ price_cents: req.cents, held_price_cents: req.cents, updated_at: new Date().toISOString() })
      .eq('id', product.id)
      .eq('price_cents', product.price_cents)
      .select('id')
    if (updErr) throw updErr
    if (!updated?.length) {
      // The audit row above said a hold was coming; record that it didn't
      // happen, so the log stays truthful (audit rows are never deleted).
      await logAudit({
        action: 'product_price_hold_aborted',
        entity_type: 'product',
        entity_id: product.id,
        entity_label: `${product.name} (${product.sku})`,
        old_value: String(product.price_cents),
        new_value: String(req.cents),
        performed_by: `admin: price review ${item.batch}; price changed before the update, nothing written`,
      })
      return NextResponse.json({ error: 'The price changed while you were looking. Reload and try again.' }, { status: 409 })
    }

    // The price is set. If marking the row fails, a retry takes the
    // "already applied" path above instead of writing again.
    const { error: markErr } = await markApproved()
    if (markErr) throw markErr

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/price-review] error:', err)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
