import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { parseSkuList } from '@/lib/line-card'
import { MAX_COLLECTION_PRODUCTS } from '@/lib/collections'

export const dynamic = 'force-dynamic'

// PUT { skus: "<pasted list>" } → replaces a collection's products with
// exactly those SKUs, in that order. Under /admin (middleware-gated).
//
// SKUs match exactly (case matters: F286606-Wt and F286606-WT are different
// products here). Unknown SKUs are reported and skipped. Hidden/inactive ones
// are kept, but they don't show on the collection page while hidden.
//
// Write order: upsert the new list first, then delete what's no longer in it,
// so a failed save never leaves the collection half-emptied.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const raw = typeof body.skus === 'string' ? body.skus : ''
  const skus = parseSkuList(raw).slice(0, MAX_COLLECTION_PRODUCTS)

  const db = getAdminClient()
  const { data: collection } = await db.from('collections').select('id, name').eq('id', id).maybeSingle()
  if (!collection) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 })

  const found: { id: string; sku: string; is_active: boolean; manually_hidden: boolean }[] = []
  for (let i = 0; i < skus.length; i += 100) {
    const { data, error } = await db.from('products').select('id, sku, is_active, manually_hidden').in('sku', skus.slice(i, i + 100))
    if (error) {
      console.error('[admin/collections/products] lookup', error.message)
      return NextResponse.json({ error: 'Could not look up the SKUs.' }, { status: 500 })
    }
    found.push(...((data ?? []) as typeof found))
  }
  const bySku = new Map(found.map((p) => [p.sku, p]))
  const ordered = skus.map((s) => bySku.get(s)).filter((p): p is (typeof found)[number] => !!p)
  const notFound = skus.filter((s) => !bySku.has(s))
  const hidden = ordered.filter((p) => !p.is_active || p.manually_hidden).map((p) => p.sku)

  if (ordered.length > 0) {
    const { error } = await db
      .from('collection_products')
      .upsert(ordered.map((p, i) => ({ collection_id: id, product_id: p.id, position: i })), { onConflict: 'collection_id,product_id' })
    if (error) {
      console.error('[admin/collections/products] upsert', error.message)
      return NextResponse.json({ error: 'Could not save the products.' }, { status: 500 })
    }
  }
  let del = db.from('collection_products').delete().eq('collection_id', id)
  if (ordered.length > 0) del = del.not('product_id', 'in', `(${ordered.map((p) => `"${p.id}"`).join(',')})`)
  const { error: delError } = await del
  if (delError) {
    console.error('[admin/collections/products] prune', delError.message)
    return NextResponse.json({ error: 'Saved the new list, but could not remove the old entries. Save again.' }, { status: 500 })
  }

  await logAudit({
    action: 'collection_products_set',
    entity_type: 'collection',
    entity_id: id,
    entity_label: collection.name,
    new_value: `${ordered.length} products`,
    performed_by: await getActorEmail(),
  })
  return NextResponse.json({ saved: ordered.map((p) => p.sku), notFound, hidden })
}
