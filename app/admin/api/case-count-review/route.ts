import { NextRequest, NextResponse } from 'next/server'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { checkCaseCountChange } from '@/lib/case-count-review'
import { isConfigured as isErplyConfigured } from '@/lib/erply'
import { parseNameReviewBody, renameSucceeded, summarizeRename } from '@/lib/name-review'
import { applyNameChange } from '@/lib/product-name-fix'

// Lives under /admin, so middleware.ts already requires the admin login.
//
// POST /admin/api/case-count-review
//   { id, action: 'approve', name }  rename to the new case count everywhere
//   { id, action: 'skip' }           the name is right; leave it
//   { id, action: 'reopen' }         put a skipped row back
//
// Same rename path and order as /admin/api/name-review: an audit row BEFORE
// the rename, then lib/product-name-fix.ts (Erply first, then WooCommerce,
// then the catalog, each refusing if its live name no longer equals
// current_name), then an audit row with the per-system result. The
// difference: here ONLY the case count may change
// (lib/case-count-review.ts checkCaseCountChange).

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
      .from('case_count_review_items')
      .select('id, batch, product_id, sku, current_name, status')
      .eq('id', req.id)
      .maybeSingle()
    if (itemErr) throw itemErr
    if (!item) return NextResponse.json({ error: 'Row not found' }, { status: 404 })

    if (req.action === 'reopen') {
      if (item.status !== 'skipped') return NextResponse.json({ error: 'Only a skipped row can be reopened.' }, { status: 409 })
      const { error } = await db
        .from('case_count_review_items')
        .update({ status: 'pending', decided_at: null })
        .eq('id', item.id)
        .eq('status', 'skipped')
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (item.status !== 'pending') return NextResponse.json({ error: 'This row was already decided. Reload the page.' }, { status: 409 })

    if (req.action === 'skip') {
      const { error } = await db
        .from('case_count_review_items')
        .update({ status: 'skipped', decided_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('status', 'pending')
      if (error) throw error
      await logAudit({
        action: 'case_count_review_kept',
        entity_type: 'product',
        entity_id: item.product_id,
        entity_label: item.sku,
        new_value: `${item.current_name} [kept; batch ${item.batch}]`,
      })
      return NextResponse.json({ ok: true })
    }

    // Approve.
    const to = req.name!
    const check = checkCaseCountChange(item.current_name, to)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
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
      performed_by: `${actor}: case-count review ${item.batch}; written before apply`,
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
      performed_by: `${actor}: case-count review ${item.batch}`,
    })

    const { error: markErr } = await db
      .from('case_count_review_items')
      .update(
        done
          ? { status: 'approved', decided_name: to, result, decided_at: new Date().toISOString() }
          : { result },
      )
      .eq('id', item.id)
    if (markErr) throw markErr

    if (!done) return NextResponse.json({ error: `Not renamed: ${result}`, rows }, { status: 409 })
    return NextResponse.json({ ok: true, rows })
  } catch (err) {
    console.error('[admin/case-count-review] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save' }, { status: 500 })
  }
}
