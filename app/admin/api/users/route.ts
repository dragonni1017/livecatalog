import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient, supabase } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import type { User, UserAppMetadata } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// This route lives under /admin, so middleware.ts already gates it behind
// the admin auth cookie — no extra auth check needed here.
//
// Unlike app/admin/api/accounts/route.ts (staff-only: admin + rep, gated by
// KNOWN_ROLES), this route covers EVERY Supabase Auth account — customers
// included — by id, with no role pre-check. Do not merge the two routes:
// accounts/route.ts's whole safety story is "can never touch a customer by
// construction," and this route is intentionally the escape hatch for that.

const ALL_ROLES = new Set(['customer', 'rep', 'admin'])

// Role storage: middleware.ts and every other role check in this codebase
// (lib/use-is-rep.ts, app/api/rep/auth/route.ts, etc.) only ever check
// app_metadata.role === 'admin' or === 'rep' with strict equality — a
// missing key already reads as "customer" everywhere. The 19 live customer
// accounts were never given the key at all (organic signup never sets it).
// To keep every account's on-disk shape consistent with that convention —
// rather than introducing a second, redundant way to spell "customer" — when
// setting role to 'customer' we DELETE the key from app_metadata instead of
// writing the literal string. Promoting to rep/admin writes the literal
// role string, same as accounts/route.ts already does.
function buildAppMetadataForRole(before: UserAppMetadata | null | undefined, role: string): UserAppMetadata {
  const base: UserAppMetadata = { ...(before ?? {}) }
  if (role === 'customer') {
    delete base.role
    return base
  }
  return { ...base, role }
}

function roleOf(user: User): string {
  const role = user.app_metadata?.role
  return typeof role === 'string' && ALL_ROLES.has(role) ? role : 'customer'
}

// PATCH { id, email?, role?, active? } — edit any account's email/role, or
// deactivate (ban) / reactivate (unban) it.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const id: string = body.id
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const db = getAdminClient()
    const { data: existing } = await db.auth.admin.getUserById(id)
    if (!existing?.user) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }
    const before = existing.user
    const currentRole = roleOf(before)

    const sessionUser = await getSessionUser()
    const isSelf = sessionUser?.id === id
    if (isSelf && typeof body.role === 'string' && body.role !== currentRole) {
      return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 })
    }
    if (isSelf && body.active === false) {
      return NextResponse.json({ error: 'You cannot deactivate your own account.' }, { status: 400 })
    }

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
      if (!ALL_ROLES.has(body.role)) {
        return NextResponse.json({ error: 'Role must be customer, rep, or admin.' }, { status: 400 })
      }
      if (body.role !== currentRole) {
        updates.app_metadata = buildAppMetadataForRole(before.app_metadata, body.role)
        auditEntries.push({ action: 'account_role_changed', old_value: currentRole, new_value: body.role })
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
    console.error('[admin/users PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update account.' }, { status: 500 })
  }
}

// DELETE ?id=... — permanently remove any account.
//
// order_requests.customer_email is plain text (not FK'd), so deleting a
// customer never touches order history — it stays fully intact and
// searchable by email.
//
// order_requests.rep_user_id IS `uuid references auth.users(id)` with no
// `on delete` clause (migration 0029_order_rep_tier.sql), so deleting a rep
// who is attributed to any order fails with a Postgres FK violation. We
// deliberately do NOT work around that by nulling rep_user_id — that would
// silently destroy order attribution. Surface a clear message instead and
// point at deactivate (ban), which is the only way to remove a rep's access
// while orders still reference them.
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const db = getAdminClient()
    const { data: existing } = await db.auth.admin.getUserById(id)
    if (!existing?.user) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }

    const sessionUser = await getSessionUser()
    if (sessionUser?.id === id) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
    }

    // Ask before trying, rather than parsing the failure. GoTrue wraps the
    // underlying Postgres FK violation and usually surfaces it as a generic
    // "Database error deleting user", so the message match below can't be
    // relied on to explain what actually went wrong.
    const { count: attributedOrders } = await db
      .from('order_requests')
      .select('id', { count: 'exact', head: true })
      .eq('rep_user_id', id)

    if (attributedOrders && attributedOrders > 0) {
      return NextResponse.json(
        {
          error: `This rep is attributed to ${attributedOrders} existing order${attributedOrders === 1 ? '' : 's'} and can't be deleted — deactivate them instead, which preserves order history.`,
        },
        { status: 409 },
      )
    }

    const { error } = await db.auth.admin.deleteUser(id)
    if (error) {
      if (/foreign key/i.test(error.message) || /rep_user_id/i.test(error.message) || /order_requests/i.test(error.message)) {
        return NextResponse.json(
          {
            error:
              "This rep is attributed to existing orders and can't be deleted — deactivate them instead, which preserves order history.",
          },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    await logAudit({
      action: 'account_deleted',
      entity_type: 'account',
      entity_id: id,
      entity_label: existing.user.email ?? undefined,
      old_value: roleOf(existing.user),
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/users DELETE] error:', err)
    return NextResponse.json({ error: 'Failed to delete account.' }, { status: 500 })
  }
}

// POST — three actions, two of which deliberately involve no email at all.
//
// Supabase Auth email is the weak link in this app: it's rate-limited per
// project (a customer who retries a few times gets "email rate limit
// exceeded" and is then stuck), and confirmation is required at signup. So a
// customer who can't receive mail has no self-service route in or back in.
// `set_password` and `create_account` exist so an admin can put someone into
// their account over the phone without email being involved anywhere.
//
//   send_password_reset { id }              — mails a recovery link
//   set_password        { id, password }    — sets a password outright
//   create_account      { email, password } — makes a pre-confirmed account
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action: string = body.action
    const db = getAdminClient()

    // ── create_account ────────────────────────────────────────────────────
    // email_confirm: true on purpose — the point of this path is to bypass a
    // confirmation mail that either won't arrive or will trip the rate limit.
    // Creates a customer (no role key), matching how organic signup stores it.
    if (action === 'create_account') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      if (!email) return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
      if (password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
      }

      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error || !data.user) {
        return NextResponse.json(
          { error: error?.message ?? 'Failed to create account.' },
          { status: 400 },
        )
      }

      await logAudit({
        action: 'account_created',
        entity_type: 'account',
        entity_id: data.user.id,
        entity_label: email,
        new_value: 'customer',
      })

      return NextResponse.json({
        account: {
          id: data.user.id,
          email: data.user.email,
          role: 'customer',
          name: null,
          company: null,
          emailConfirmed: true,
          createdAt: data.user.created_at,
          lastSignInAt: null,
          bannedUntil: null,
        },
      })
    }

    const id: string = body.id
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const { data: existing } = await db.auth.admin.getUserById(id)
    if (!existing?.user?.email) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }

    // ── set_password ──────────────────────────────────────────────────────
    // Also confirms the address: an account stuck unconfirmed can't sign in
    // even with a correct password, and these accounts are typically stuck
    // precisely because the confirmation mail never arrived.
    if (action === 'set_password') {
      const password = typeof body.password === 'string' ? body.password : ''
      if (password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
      }

      const { error } = await db.auth.admin.updateUserById(id, { password, email_confirm: true })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAudit({
        action: 'account_password_set_by_admin',
        entity_type: 'account',
        entity_id: id,
        entity_label: existing.user.email,
      })

      return NextResponse.json({ ok: true })
    }

    // ── send_password_reset ───────────────────────────────────────────────
    // The anon client (plain createClient) defaults to the implicit flow, so
    // the emailed link carries the grant in its fragment and completes from
    // any browser — unlike a PKCE link, which only works in the browser that
    // requested it. /reset-password understands both.
    if (action !== 'send_password_reset') {
      return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 })
    }

    const { error } = await supabase.auth.resetPasswordForEmail(existing.user.email, {
      redirectTo: `${request.nextUrl.origin}/reset-password`,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAudit({
      action: 'account_password_reset_sent',
      entity_type: 'account',
      entity_id: id,
      entity_label: existing.user.email,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/users POST] error:', err)
    return NextResponse.json({ error: 'Action failed.' }, { status: 500 })
  }
}
