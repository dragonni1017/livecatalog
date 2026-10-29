import { NextRequest, NextResponse } from 'next/server'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { keepsPackSpec } from '@/lib/cleanup'
import { isConfigured as isErplyConfigured } from '@/lib/erply'
import { applyNameChange } from '@/lib/product-name-fix'
import { parseNameReviewBody, renameSucceeded, summarizeRename } from '@/lib/name-review'

// Lives under /admin, so middleware.ts already requires the admin login.
//
// POST /admin/api/name-review
//   { id, action: 'approve', name }  rename the product everywhere
//   { id, action: 'skip' }           leave the name alone
//   { id, action: 'reopen' }         put a skipped row back
//
// Approve renames through lib/product-name-fix.ts, the same code as
// /admin/api/cleanup/name and scripts/fix-product-names.ts: Erply first (the
// master; the sync copies names from it), then WooCommerce, then the
// catalog, each refusing if its live name no longer equals the row's
// current_name. An audit row is written BEFORE the rename and another with
// the per-system result after. A pack-spec change is refused, as in Cleanup:
// those carry a business reason and go through the script.

export const dynamic = 'force-dynamic'

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
  const req = parseNameReviewBody(body)
  if ('error' in req) return NextResponse.json({ error: req.error }, { status: 400 })
  if (isMockMode()) return NextResponse.json({ ok: true, mock: true })

  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const { data: item, error: itemErr } = await db
      .from('name_review_items')
      .select('id, batch, product_id, sku, current_name, status')
      .eq('id', req.id)
      .maybeSingle()
    if (itemErr) throw itemErr
    if (!item) return NextResponse.json({ error: 'Row not found' }, { status: 404 })

    if (req.action === 'reopen') {
      if (item.status !== 'skipped') return NextResponse.json({ error: 'Only a skipped row can be reopened.' }, { status: 409 })
      const { error } = await db.from('name_review_items').update({ status: 'pending', decided_at: null }).eq('id', item.id).eq('status', 'skipped')
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (item.status !== 'pending') return NextResponse.json({ error: 'This row was already decided. Reload the page.' }, { status: 409 })

    if (req.action === 'skip') {
      const { error } = await db
        .from('name_review_items')
        .update({ status: 'skipped', decided_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('status', 'pending')
      if (error) throw error
      await logAudit({ action: 'name_review_skipped', entity_type: 'product', entity_id: item.product_id, entity_label: item.sku, new_value: item.batch })
      return NextResponse.json({ ok: true })
    }

    // Approve.
    const to = req.name!
    if (to === item.current_name) return NextResponse.json({ error: 'That is the same as the current name. Use Skip to keep it.' }, { status: 400 })
    if (!keepsPackSpec(item.current_name, to)) {
      return NextResponse.json(
        { error: 'That changes the pack size part of the name (e.g. "12/pk 20bx/cs"). Only the description part can be changed here.' },
        { status: 400 },
      )
    }
    if (!isErplyConfigured()) {
      return NextResponse.json({ error: 'Erply is not configured here, so names cannot be changed.' }, { status: 503 })
    }

    const actor = await getActorEmail()
    const { error: auditErr } = await db.from('audit_log').insert({
      action: 'product_name_change_started',
      entity_type: 'product',
      entity_id: item.product_id,
      entity_label: item.sku,
      old_value: item.current_name,
      new_value: to,
      performed_by: `${actor}: name review ${item.batch}; written before apply`,
    })
    if (auditErr) throw auditErr

    const rows = await applyNameChange({ sku: item.sku, expect: item.current_name, to, apply: true, db })
    const result = summarizeRename(rows)
    const done = renameSucceeded(rows)

    await logAudit({
      action: 'product_name_changed',
      entity_type: 'product',
      entity_id: item.product_id,
      entity_label: item.sku,
      old_value: item.current_name,
      new_value: `${to} [${result}]`,
      performed_by: `${actor}: name review ${item.batch}`,
    })

    const { error: markErr } = await db
      .from('name_review_items')
      .update(
        done
          ? { status: 'approved', decided_name: to, result, decided_at: new Date().toISOString() }
          : { result },
      )
      .eq('id', item.id)
    if (markErr) throw markErr

    if (!done) {
      return NextResponse.json({ error: `Not renamed: ${result}`, rows }, { status: 409 })
    }
    return NextResponse.json({ ok: true, rows })
  } catch (err) {
    console.error('[admin/name-review] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save' }, { status: 500 })
  }
}
