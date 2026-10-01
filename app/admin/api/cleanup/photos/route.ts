import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { rawCloudinaryPublicId, skuCandidatesForPublicId } from '@/lib/cleanup'

export const dynamic = 'force-dynamic'

// POST { items: [{ sku, urls[] }], replace } -> { updated, skipped[], failures[] }
//
// Records photos the browser has ALREADY uploaded to Cloudinary (signed by
// ./photo-signature). Catalog-only: writes products.image_url / image_urls
// and nothing else -- never Erply, never WooCommerce (decided 2026-10-01).
//
// Same write as the receiving screen's photo route: image_url = urls[0],
// image_urls = urls, needs_photo = false.
//
// Guards, because the browser's view of the catalog may be minutes old:
//  - Every URL must be a RAW original on this account's cloud whose public id
//    is this SKU or SKU-n. Anything else is refused, so a transformed URL can't
//    be baked in (docs/memory/project-image-sizing-contract.md) and one SKU's
//    photo can't be attached to another.
//  - Unless `replace` is set, a product that has gained an image since the
//    screen loaded is skipped, not overwritten -- re-checked here, and again
//    in the UPDATE's own WHERE so a concurrent write can't slip between.

const MAX_ITEMS = 100
const MAX_URLS_PER_ITEM = 20

interface Item {
  sku: string
  urls: string[]
}

function parseItems(raw: unknown): Item[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return null
  const out: Item[] = []
  for (const r of raw) {
    const sku = (r as { sku?: unknown })?.sku
    const urls = (r as { urls?: unknown })?.urls
    if (typeof sku !== 'string' || !sku.trim()) return null
    if (!Array.isArray(urls) || urls.length === 0 || urls.length > MAX_URLS_PER_ITEM) return null
    if (!urls.every((u) => typeof u === 'string' && u.trim())) return null
    out.push({ sku: sku.trim(), urls: (urls as string[]).map((u) => u.trim()) })
  }
  return out
}

export async function POST(request: NextRequest) {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME
    if (!cloudName) {
      return NextResponse.json({ error: 'Cloudinary is not configured in this environment.' }, { status: 503 })
    }

    const body = await request.json().catch(() => null)
    const items = parseItems((body as { items?: unknown } | null)?.items)
    if (!items) {
      return NextResponse.json(
        { error: `items must be 1-${MAX_ITEMS} entries of { sku, urls: [1-${MAX_URLS_PER_ITEM} strings] }` },
        { status: 400 },
      )
    }
    const replace = (body as { replace?: unknown }).replace === true

    const db = getAdminClient()
    const skus = [...new Set(items.map((i) => i.sku))]
    const products = new Map<string, { id: string; sku: string; image_url: string | null }>()
    for (let i = 0; i < skus.length; i += 200) {
      const { data, error } = await db
        .from('products')
        .select('id, sku, image_url')
        .in('sku', skus.slice(i, i + 200))
      if (error) throw error
      for (const p of data ?? []) products.set(String(p.sku), p as { id: string; sku: string; image_url: string | null })
    }

    const actor = await getActorEmail()
    let updated = 0
    const skipped: string[] = []
    const failures: string[] = []

    for (const item of items) {
      const product = products.get(item.sku)
      if (!product) {
        failures.push(`${item.sku}: not in the catalog`)
        continue
      }

      const bad = item.urls.find((u) => {
        const id = rawCloudinaryPublicId(u, cloudName)
        return !id || !skuCandidatesForPublicId(id).includes(item.sku)
      })
      if (bad) {
        failures.push(`${item.sku}: refused ${bad} -- not a raw Cloudinary original named for this SKU`)
        continue
      }

      const hasImage = Boolean((product.image_url ?? '').trim())
      if (hasImage && !replace) {
        skipped.push(item.sku)
        continue
      }

      let query = db
        .from('products')
        .update({
          image_url: item.urls[0],
          image_urls: item.urls,
          needs_photo: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', product.id)
      if (!replace) query = query.or('image_url.is.null,image_url.eq.')
      const { data: written, error } = await query.select('id')
      if (error) {
        failures.push(`${item.sku}: ${error.message}`)
        continue
      }
      if (!written || written.length === 0) {
        // The WHERE above found an image that wasn't there a moment ago.
        skipped.push(item.sku)
        continue
      }

      updated++
      await logAudit({
        action: 'cleanup_photo_set',
        entity_type: 'product',
        entity_id: product.id,
        entity_label: product.sku,
        // The previous URL is kept so a mistaken replace can be put back by hand.
        old_value: product.image_url ?? undefined,
        new_value: item.urls.join(' '),
        performed_by: actor,
      })
    }

    return NextResponse.json({ ok: failures.length === 0, updated, skipped, failures })
  } catch (err) {
    console.error('[admin/cleanup/photos] error:', err)
    return NextResponse.json({ error: 'Failed to save the photos.' }, { status: 500 })
  }
}
