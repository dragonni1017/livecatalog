import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'
import { parseOwnerQuestionBody } from '@/lib/owner-questions'

// Lives under /admin, so middleware.ts already requires the admin login.
//
// POST /admin/api/owner-questions
//   { id, action: 'answer', answer }  save the owner's answer (status answered)
//   { id, action: 'done' }            finished (e.g. fixed in QuickBooks)
//   { id, action: 'reopen' }          back to open
//   { id, action: 'rename', name }    queue a rename in Name review, mark done
// Every change writes an audit row. A rename is NOT applied here: it becomes
// a pending name_review_items row (batch "owner-questions") and is renamed
// on /admin/name-review, audit first, with its pack-spec guard.

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const req = parseOwnerQuestionBody(await request.json().catch(() => null))
  if ('error' in req) return NextResponse.json({ error: req.error }, { status: 400 })

  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const by = (await getSessionUser())?.email ?? 'admin'
    const now = new Date().toISOString()

    const { data: q, error: qErr } = await db
      .from('owner_questions')
      .select('id, sku, kind, product_id, answer, status')
      .eq('id', req.id)
      .maybeSingle()
    if (qErr) throw qErr
    if (!q) return NextResponse.json({ error: 'Question not found' }, { status: 404 })

    const audit = async (action: string, oldValue: string | null, newValue: string) => {
      const { error } = await db.from('audit_log').insert({
        action,
        entity_type: 'owner_question',
        entity_id: q.id,
        entity_label: `${q.sku} (${q.kind})`,
        old_value: oldValue,
        new_value: newValue,
        performed_by: by,
      })
      if (error) throw error
    }

    if (req.action === 'answer') {
      await audit('owner_question_answered', q.answer, req.answer)
      const { error } = await db
        .from('owner_questions')
        .update({ answer: req.answer, status: 'answered', answered_by: by, answered_at: now })
        .eq('id', q.id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (req.action === 'done' || req.action === 'reopen') {
      const status = req.action === 'done' ? 'done' : 'open'
      await audit(`owner_question_${req.action === 'done' ? 'done' : 'reopened'}`, q.status, status)
      const { error } = await db.from('owner_questions').update({ status }).eq('id', q.id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // rename: queue it for Name review; nothing is renamed here.
    if (!q.product_id) return NextResponse.json({ error: 'This SKU is not in the catalog, so it cannot be renamed.' }, { status: 409 })
    const { data: p, error: pErr } = await db.from('products').select('id, sku, name').eq('id', q.product_id).maybeSingle()
    if (pErr) throw pErr
    if (!p) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    if (p.name === req.name) return NextResponse.json({ error: 'That is already the product name.' }, { status: 400 })

    await audit('owner_question_sent_to_name_review', p.name, req.name)
    // Every row carries every key (supabase-js sends one column list).
    const { error: insErr } = await db.from('name_review_items').upsert(
      [{
        batch: 'owner-questions',
        product_id: p.id,
        sku: p.sku,
        problem: q.kind,
        reason: `Owner's answer: ${q.answer ?? '(none typed)'}`,
        current_name: p.name,
        suggested_name: req.name,
      }],
      { onConflict: 'batch,product_id', ignoreDuplicates: true },
    )
    if (insErr) throw insErr
    const { error } = await db
      .from('owner_questions')
      .update({ status: 'done', answered_by: by, answered_at: now, answer: q.answer ?? `Rename to: ${req.name}` })
      .eq('id', q.id)
    if (error) throw error
    return NextResponse.json({ ok: true, queued: true })
  } catch (err) {
    console.error('[admin/api/owner-questions] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save' }, { status: 500 })
  }
}
