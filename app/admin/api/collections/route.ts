import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { COLLECTION_FIELDS, parseCollectionInput } from '@/lib/collections'

export const dynamic = 'force-dynamic'

// Create / update / delete collections (migration 0059). Under /admin, so
// middleware.ts already requires the admin role.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function dbError(message: string | undefined, fallback: string) {
  // 23505 = unique violation: the only unique column besides the id is slug.
  if (message?.includes('collections_slug_key') || message?.includes('duplicate key')) {
    return NextResponse.json({ error: 'Another collection already uses that URL name.' }, { status: 409 })
  }
  console.error('[admin/collections]', message)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

// POST { name, slug?, description?, is_active?, starts_on?, ends_on?, display_order? } → { collection }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const parsed = parseCollectionInput(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const db = getAdminClient()
  const { data, error } = await db.from('collections').insert(parsed.value).select(COLLECTION_FIELDS).single()
  if (error || !data) return dbError(error?.message, 'Could not create the collection.')
  await logAudit({ action: 'collection_created', entity_type: 'collection', entity_id: data.id, entity_label: data.name, performed_by: await getActorEmail() })
  return NextResponse.json({ collection: data })
}

// PATCH { id, ...same fields } → { collection }
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 })
  const parsed = parseCollectionInput(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const db = getAdminClient()
  const { data, error } = await db
    .from('collections')
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(COLLECTION_FIELDS)
    .maybeSingle()
  if (error) return dbError(error.message, 'Could not save the collection.')
  if (!data) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 })
  await logAudit({ action: 'collection_updated', entity_type: 'collection', entity_id: id, entity_label: data.name, performed_by: await getActorEmail() })
  return NextResponse.json({ collection: data })
}

// DELETE ?id=… → { ok }   (its product links cascade)
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 })
  const db = getAdminClient()
  const { data, error } = await db.from('collections').delete().eq('id', id).select('name').maybeSingle()
  if (error) return dbError(error.message, 'Could not delete the collection.')
  if (!data) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 })
  await logAudit({ action: 'collection_deleted', entity_type: 'collection', entity_id: id, entity_label: data.name, performed_by: await getActorEmail() })
  return NextResponse.json({ ok: true })
}
