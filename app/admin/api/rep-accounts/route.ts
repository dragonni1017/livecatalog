import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// This route lives under /admin, so middleware.ts already gates it behind
// the admin auth cookie — no extra auth check needed here.
//
// Rep accounts are plain Supabase Auth users with app_metadata.role='rep'
// (same manual-provisioning model as admin accounts) — there's no separate
// `reps` table. Every mutation here re-confirms role==='rep' on the target
// user before touching it, so this route can never be used to ban/delete an
// admin or customer account by ID.

// POST { email, password } — create a new rep account.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    const db = getAdminClient()
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'rep' },
    })
    if (error || !data.user) {
      return NextResponse.json({ error: error?.message ?? 'Failed to create rep account.' }, { status: 400 })
    }

    await logAudit({
      action: 'rep_account_created',
      entity_type: 'rep_account',
      entity_id: data.user.id,
      entity_label: email,
    })

    return NextResponse.json({
      rep: {
        id: data.user.id,
        email: data.user.email,
        created_at: data.user.created_at,
        last_sign_in_at: data.user.last_sign_in_at ?? null,
        banned_until: null,
      },
    })
  } catch (err) {
    console.error('[admin/rep-accounts POST] error:', err)
    return NextResponse.json({ error: 'Failed to create rep account.' }, { status: 500 })
  }
}

// PATCH { id, active } — deactivate (ban) or reactivate (unban) a rep account.
// Deactivating rather than deleting keeps the account (and its order
// history via rep_user_id) intact and reversible.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const id: string = body.id
    const active = Boolean(body.active)
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const db = getAdminClient()
    const { data: existing } = await db.auth.admin.getUserById(id)
    if (!existing?.user || existing.user.app_metadata?.role !== 'rep') {
      return NextResponse.json({ error: 'Not a rep account.' }, { status: 404 })
    }

    const { error } = await db.auth.admin.updateUserById(id, {
      // '876000h' (~100 years) is GoTrue's conventional stand-in for a
      // permanent ban; 'none' clears it.
      ban_duration: active ? 'none' : '876000h',
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAudit({
      action: active ? 'rep_account_reactivated' : 'rep_account_deactivated',
      entity_type: 'rep_account',
      entity_id: id,
      entity_label: existing.user.email ?? undefined,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/rep-accounts PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update rep account.' }, { status: 500 })
  }
}

// DELETE ?id=... — permanently remove a rep account.
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const db = getAdminClient()
    const { data: existing } = await db.auth.admin.getUserById(id)
    if (!existing?.user || existing.user.app_metadata?.role !== 'rep') {
      return NextResponse.json({ error: 'Not a rep account.' }, { status: 404 })
    }

    const { error } = await db.auth.admin.deleteUser(id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAudit({
      action: 'rep_account_deleted',
      entity_type: 'rep_account',
      entity_id: id,
      entity_label: existing.user.email ?? undefined,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/rep-accounts DELETE] error:', err)
    return NextResponse.json({ error: 'Failed to delete rep account.' }, { status: 500 })
  }
}
