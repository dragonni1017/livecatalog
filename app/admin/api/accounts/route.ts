import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// This route lives under /admin, so middleware.ts already gates it behind
// the admin auth cookie — no extra auth check needed here.
//
// Staff accounts (admin + rep) are plain Supabase Auth users with
// app_metadata.role set manually — there's no separate `admins`/`reps`
// table. Every mutation here re-confirms the target user's role is 'admin'
// or 'rep' before touching it, so this route can never be used to touch a
// customer account by ID.

const KNOWN_ROLES = new Set(['admin', 'rep'])

// POST { email, password, role } — create a new staff account.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const role = typeof body.role === 'string' ? body.role : ''

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }
    if (!KNOWN_ROLES.has(role)) {
      return NextResponse.json({ error: 'Role must be admin or rep.' }, { status: 400 })
    }

    const db = getAdminClient()
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
    })

    if (error || !data.user) {
      // Email already belongs to a Supabase Auth user — most commonly an
      // existing customer account (see app/admin/users). Promote it to the
      // requested staff role instead of failing, without touching its
      // password so the customer's own login keeps working if the promotion
      // is ever reversed.
      if (/already.*registered/i.test(error?.message ?? '')) {
        const { data: list, error: listError } = await db.auth.admin.listUsers({ perPage: 200 })
        const existing = listError ? undefined : list?.users.find((u) => u.email?.toLowerCase() === email)
        if (!existing) {
          return NextResponse.json({ error: 'A user with this email already exists but could not be looked up.' }, { status: 400 })
        }
        if (KNOWN_ROLES.has(existing.app_metadata?.role)) {
          return NextResponse.json(
            { error: `This email is already a staff account (${existing.app_metadata?.role}) — edit its role from the table below instead.` },
            { status: 400 },
          )
        }

        const { error: promoteError } = await db.auth.admin.updateUserById(existing.id, {
          app_metadata: { ...existing.app_metadata, role },
        })
        if (promoteError) return NextResponse.json({ error: promoteError.message }, { status: 400 })

        await logAudit({
          action: 'account_role_changed',
          entity_type: 'account',
          entity_id: existing.id,
          entity_label: email,
          old_value: existing.app_metadata?.role ?? 'customer',
          new_value: role,
        })

        return NextResponse.json({
          account: {
            id: existing.id,
            email: existing.email,
            role,
            created_at: existing.created_at,
            last_sign_in_at: existing.last_sign_in_at ?? null,
            banned_until: existing.banned_until ?? null,
          },
        })
      }
      return NextResponse.json({ error: error?.message ?? 'Failed to create account.' }, { status: 400 })
    }

    await logAudit({
      action: 'account_created',
      entity_type: 'account',
      entity_id: data.user.id,
      entity_label: email,
      new_value: role,
    })

    return NextResponse.json({
      account: {
        id: data.user.id,
        email: data.user.email,
        role,
        created_at: data.user.created_at,
        last_sign_in_at: data.user.last_sign_in_at ?? null,
        banned_until: null,
      },
    })
  } catch (err) {
    console.error('[admin/accounts POST] error:', err)
    return NextResponse.json({ error: 'Failed to create account.' }, { status: 500 })
  }
}

// PATCH { id, email?, role?, active? } — edit a staff account's email/role,
// or deactivate (ban) / reactivate (unban) it. Deactivating rather than
// deleting keeps the account (and its order history via rep_user_id for
// reps) intact and reversible.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const id: string = body.id
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const db = getAdminClient()
    const { data: existing } = await db.auth.admin.getUserById(id)
    if (!existing?.user || !KNOWN_ROLES.has(existing.user.app_metadata?.role)) {
      return NextResponse.json({ error: 'Not a staff account.' }, { status: 404 })
    }
    const before = existing.user

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any = {}
    const auditEntries: Array<{ action: string; old_value?: string; new_value?: string }> = []

    if (typeof body.email === 'string') {
      const email = body.email.trim().toLowerCase()
      if (email && email !== before.email) {
        updates.email = email
        updates.email_confirm = true
        auditEntries.push({ action: 'account_email_changed', old_value: before.email, new_value: email })
      }
    }

    if (typeof body.role === 'string') {
      if (!KNOWN_ROLES.has(body.role)) {
        return NextResponse.json({ error: 'Role must be admin or rep.' }, { status: 400 })
      }
      if (body.role !== before.app_metadata?.role) {
        updates.app_metadata = { ...before.app_metadata, role: body.role }
        auditEntries.push({ action: 'account_role_changed', old_value: before.app_metadata?.role, new_value: body.role })
      }
    }

    if (typeof body.active === 'boolean') {
      const currentlyActive = !before.banned_until || new Date(before.banned_until).getTime() < Date.now()
      if (body.active !== currentlyActive) {
        // '876000h' (~100 years) is GoTrue's conventional stand-in for a
        // permanent ban; 'none' clears it.
        updates.ban_duration = body.active ? 'none' : '876000h'
        auditEntries.push({ action: body.active ? 'account_reactivated' : 'account_deactivated' })
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true })
    }

    const { error } = await db.auth.admin.updateUserById(id, updates)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    for (const entry of auditEntries) {
      await logAudit({
        entity_type: 'account',
        entity_id: id,
        entity_label: updates.email ?? before.email ?? undefined,
        ...entry,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/accounts PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update account.' }, { status: 500 })
  }
}

// DELETE ?id=... — permanently remove a staff account.
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const db = getAdminClient()
    const { data: existing } = await db.auth.admin.getUserById(id)
    if (!existing?.user || !KNOWN_ROLES.has(existing.user.app_metadata?.role)) {
      return NextResponse.json({ error: 'Not a staff account.' }, { status: 404 })
    }

    const { error } = await db.auth.admin.deleteUser(id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAudit({
      action: 'account_deleted',
      entity_type: 'account',
      entity_id: id,
      entity_label: existing.user.email ?? undefined,
      old_value: existing.user.app_metadata?.role,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/accounts DELETE] error:', err)
    return NextResponse.json({ error: 'Failed to delete account.' }, { status: 500 })
  }
}
