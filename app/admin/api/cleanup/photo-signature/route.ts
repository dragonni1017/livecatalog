import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { isCloudinaryConfigured, signParams } from '@/lib/cloudinary'
import { skuCandidatesForPublicId } from '@/lib/cleanup'

export const dynamic = 'force-dynamic'

// POST { publicIds: string[] } -> { cloudName, apiKey, timestamp, signatures }
//
// Signs browser-direct Cloudinary uploads for /admin/cleanup. The photo bytes
// go straight from the browser to api.cloudinary.com; only this signature
// request passes through a Vercel function, because a function body is capped
// at 4.5 MB and a folder of phone photos is far larger than that.
// (The receiving screen's photo route uploads server-side and is limited by
// that cap -- fine for a container's handful of new products, not for a
// catalog-wide photo pass.)
//
// Each signature covers exactly { public_id, timestamp }, the same params
// lib/cloudinary.ts's uploadToCloudinary signs, so the browser must send those
// two plus api_key and file and nothing else.
//
// Only ids that belong to a real product are signed -- the bare SKU or
// `${SKU}-${n}` (the receiving convention) -- so this endpoint can't be used
// to overwrite an unrelated asset in the account. Signatures expire with the
// timestamp after an hour on Cloudinary's side; the screen asks for them in
// small batches just before uploading.

const MAX_IDS = 200

export async function POST(request: NextRequest) {
  try {
    if (!isCloudinaryConfigured()) {
      return NextResponse.json(
        { error: 'Cloudinary is not configured in this environment, so photos cannot be uploaded.' },
        { status: 503 },
      )
    }

    const body = await request.json().catch(() => null)
    const raw = (body as { publicIds?: unknown } | null)?.publicIds
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every((v) => typeof v === 'string' && v.trim())) {
      return NextResponse.json({ error: 'publicIds must be a non-empty array of strings' }, { status: 400 })
    }
    const publicIds = [...new Set((raw as string[]).map((v) => v.trim()))]
    if (publicIds.length > MAX_IDS) {
      return NextResponse.json({ error: `At most ${MAX_IDS} photos per signature request` }, { status: 400 })
    }

    const candidates = [...new Set(publicIds.flatMap(skuCandidatesForPublicId))]
    const db = getAdminClient()
    const known = new Set<string>()
    for (let i = 0; i < candidates.length; i += 200) {
      const { data, error } = await db.from('products').select('sku').in('sku', candidates.slice(i, i + 200))
      if (error) throw error
      for (const row of data ?? []) if (row.sku) known.add(String(row.sku))
    }

    const unknown = publicIds.filter((id) => !skuCandidatesForPublicId(id).some((sku) => known.has(sku)))
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `These are not product SKUs (or SKU-n views of one): ${unknown.slice(0, 10).join(', ')}` },
        { status: 400 },
      )
    }

    const apiSecret = process.env.CLOUDINARY_API_SECRET!
    const timestamp = Math.floor(Date.now() / 1000)
    const signatures: Record<string, string> = {}
    for (const id of publicIds) signatures[id] = signParams({ public_id: id, timestamp }, apiSecret)

    return NextResponse.json({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      signatures,
    })
  } catch (err) {
    console.error('[admin/cleanup/photo-signature] error:', err)
    return NextResponse.json({ error: 'Failed to sign the photo upload.' }, { status: 500 })
  }
}
