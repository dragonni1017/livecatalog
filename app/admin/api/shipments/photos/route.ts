import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { isCloudinaryConfigured, uploadToCloudinary } from '@/lib/cloudinary'
import { IMAGE_RE, matchFilesToProducts, toPhotoFile } from '@/lib/photo-matching'

export const dynamic = 'force-dynamic'

// POST multipart { shipment_id, files[] } — upload this container's photos.
//
// The photos for a container arrive as a folder of files named by SKU. Until
// now attaching them meant running scripts/upload-container-photos.ts, which
// works but is a step somebody has to remember after the container is
// otherwise finished -- and a product with no photo is not obviously wrong
// when you look at it.
//
// Matching is lib/photo-matching.ts, the same module the script and the gap
// finder use, so this cannot decide a file belongs to a product that they
// would disagree about. That sharing is why those scripts are TypeScript.
//
// Scoped to products this shipment created: the browser will happily hand
// over a whole folder, and a stray file matching some unrelated SKU should
// not quietly overwrite that product's photo from the receiving screen.

export async function POST(request: NextRequest) {
  try {
    if (!isCloudinaryConfigured()) {
      return NextResponse.json(
        { error: 'Cloudinary is not configured in this environment, so photos cannot be uploaded.' },
        { status: 503 },
      )
    }

    const form = await request.formData()
    const shipmentId = String(form.get('shipment_id') ?? '')
    if (!shipmentId) return NextResponse.json({ error: 'Missing shipment_id' }, { status: 400 })

    const files = form.getAll('files').filter((f): f is File => f instanceof File && IMAGE_RE.test(f.name))
    if (files.length === 0) {
      return NextResponse.json({ error: 'No image files were sent (.jpg, .png or .webp).' }, { status: 400 })
    }

    const db = getAdminClient()
    const { data: lines } = await db
      .from('shipment_lines')
      .select('sku, erply_created_product_id')
      .eq('shipment_id', shipmentId)
      .not('erply_created_product_id', 'is', null)

    const shipmentSkus = [...new Set((lines ?? []).map((l) => String(l.sku)))]
    if (shipmentSkus.length === 0) {
      return NextResponse.json({ error: 'This shipment created no products to attach photos to.' }, { status: 400 })
    }

    const products: { id: string; sku: string; image_url: string | null }[] = []
    for (let i = 0; i < shipmentSkus.length; i += 200) {
      const { data } = await db
        .from('products')
        .select('id, sku, image_url')
        .in('sku', shipmentSkus.slice(i, i + 200))
      products.push(...((data ?? []) as typeof products))
    }
    if (products.length === 0) {
      return NextResponse.json(
        { error: 'None of this shipment\'s products are in the catalog yet — add them first.' },
        { status: 400 },
      )
    }

    const bySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p]))
    const byName = new Map(files.map((f) => [f.name, f]))
    const { plan, unmatched } = matchFilesToProducts(files.map((f) => toPhotoFile(f.name)), bySku)

    const replace = String(form.get('replace') ?? '') === 'true'
    const entries = [...plan.values()]
    const skippedHaveImage = entries.filter((e) => e.product.image_url && !replace)
    const todo = replace ? entries : entries.filter((e) => !e.product.image_url)

    let uploaded = 0
    const failures: string[] = []
    for (const e of todo) {
      const sku = e.product.sku
      try {
        const urls: string[] = []
        const ordered = [
          ...(e.primary ? [{ id: sku, file: e.primary }] : []),
          ...e.views.sort((a, b) => a.n - b.n).map((v) => ({ id: `${sku}-${v.n}`, file: v.file })),
        ]
        for (const { id, file } of ordered) {
          const real = byName.get(file.name)
          if (!real) continue
          urls.push(await uploadToCloudinary(await real.arrayBuffer(), id, file.name))
        }
        if (urls.length === 0) continue
        const { error } = await db
          .from('products')
          .update({ image_url: urls[0], image_urls: urls, needs_photo: false })
          .eq('id', e.product.id)
        if (error) throw new Error(error.message)
        uploaded++
      } catch (err) {
        failures.push(`${sku}: ${(err as Error).message}`)
      }
    }

    if (uploaded > 0) {
      await logAudit({
        action: 'shipment_photos_uploaded',
        entity_type: 'shipment',
        entity_id: shipmentId,
        new_value: `${uploaded} product photo(s) uploaded`,
        performed_by: await getActorEmail(),
      })
    }

    return NextResponse.json({
      ok: failures.length === 0,
      uploaded,
      skippedHaveImage: skippedHaveImage.map((e) => e.product.sku),
      // Named, not counted: these are usually SKUs from a container that has
      // not been staged yet, and knowing which is the useful part.
      unmatched: unmatched.map((f) => f.name).slice(0, 40),
      unmatchedCount: unmatched.length,
      failures,
    })
  } catch (err) {
    console.error('[admin/shipments/photos] error:', err)
    return NextResponse.json({ error: 'Failed to upload the photos.' }, { status: 500 })
  }
}
