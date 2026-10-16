import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'
import { getAdminClient } from '@/lib/supabase'
import { ADDRESS_FIELDS, MAX_ADDRESSES, parseAddress } from '@/lib/customer-addresses'

export const dynamic = 'force-dynamic'

// A signed-in customer's ship-to address book (migration 0058). Every /api/*
// route is public (middleware only gates /admin and /rep), so the session
// check is the only guard. Every query filters on the session user's id, so a
// caller naming another customer's address id just gets "not found".

async function requireUserId(): Promise<string | null> {
  const user = await getSessionUser()
  return user?.id ?? null
}

const unauthorized = () => NextResponse.json({ error: 'Sign in to manage your addresses.' }, { status: 401 })

// A non-uuid id would make Postgres throw (22P02) and surface as a 500.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function list(userId: string) {
  const db = getAdminClient()
  return db
    .from('customer_addresses')
    .select(ADDRESS_FIELDS)
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
}

/** Clears the current default so the one-default unique index allows a new one. */
async function clearDefault(userId: string, exceptId?: string) {
  const db = getAdminClient()
  let q = db.from('customer_addresses').update({ is_default: false }).eq('user_id', userId).eq('is_default', true)
  if (exceptId) q = q.neq('id', exceptId)
  return q
}

// GET → { addresses }
export async function GET() {
  const userId = await requireUserId()
  if (!userId) return unauthorized()
  const { data, error } = await list(userId)
  if (error) {
    console.error('[account/addresses GET]', error.message)
    return NextResponse.json({ error: 'Could not load your addresses.' }, { status: 500 })
  }
  return NextResponse.json({ addresses: data ?? [] })
}

// POST { label?, address1, address2?, city, state, zip, isDefault? } → { addresses }
export async function POST(request: NextRequest) {
  const userId = await requireUserId()
  if (!userId) return unauthorized()
  const body = await request.json().catch(() => ({}))
  const parsed = parseAddress(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const db = getAdminClient()
  const { data: existing } = await db.from('customer_addresses').select('id').eq('user_id', userId)
  const count = existing?.length ?? 0
  if (count >= MAX_ADDRESSES) {
    return NextResponse.json({ error: `You can save up to ${MAX_ADDRESSES} addresses.` }, { status: 400 })
  }

  // The first address is the default automatically.
  const makeDefault = body.isDefault === true || count === 0
  if (makeDefault) await clearDefault(userId)
  const { error } = await db
    .from('customer_addresses')
    .insert({ ...parsed.address, user_id: userId, is_default: makeDefault })
  if (error) {
    console.error('[account/addresses POST]', error.message)
    return NextResponse.json({ error: 'Could not save the address.' }, { status: 500 })
  }
  const { data } = await list(userId)
  return NextResponse.json({ addresses: data ?? [] })
}

// PATCH { id, setDefault: true } or { id, ...address fields } → { addresses }
export async function PATCH(request: NextRequest) {
  const userId = await requireUserId()
  if (!userId) return unauthorized()
  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Address not found.' }, { status: 404 })

  const db = getAdminClient()
  const { data: own } = await db.from('customer_addresses').select('id').eq('id', id).eq('user_id', userId).maybeSingle()
  if (!own) return NextResponse.json({ error: 'Address not found.' }, { status: 404 })

  if (body.setDefault === true) {
    await clearDefault(userId, id)
    const { error } = await db.from('customer_addresses').update({ is_default: true, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
    if (error) {
      console.error('[account/addresses PATCH default]', error.message)
      return NextResponse.json({ error: 'Could not set the default address.' }, { status: 500 })
    }
  } else {
    const parsed = parseAddress(body)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { error } = await db
      .from('customer_addresses')
      .update({ ...parsed.address, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
    if (error) {
      console.error('[account/addresses PATCH]', error.message)
      return NextResponse.json({ error: 'Could not update the address.' }, { status: 500 })
    }
  }
  const { data } = await list(userId)
  return NextResponse.json({ addresses: data ?? [] })
}

// DELETE ?id=… → { addresses }
export async function DELETE(request: NextRequest) {
  const userId = await requireUserId()
  if (!userId) return unauthorized()
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Address not found.' }, { status: 404 })

  const db = getAdminClient()
  const { data: removed, error } = await db
    .from('customer_addresses')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('is_default')
    .maybeSingle()
  if (error) {
    console.error('[account/addresses DELETE]', error.message)
    return NextResponse.json({ error: 'Could not delete the address.' }, { status: 500 })
  }
  if (!removed) return NextResponse.json({ error: 'Address not found.' }, { status: 404 })

  // Deleting the default promotes the oldest remaining address, so there's
  // always a default while any address exists.
  if (removed.is_default) {
    const { data: next } = await db
      .from('customer_addresses')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (next) await db.from('customer_addresses').update({ is_default: true }).eq('id', next.id).eq('user_id', userId)
  }
  const { data } = await list(userId)
  return NextResponse.json({ addresses: data ?? [] })
}
