import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']

// POST /admin/api/products/upload-image — mints a Supabase Storage signed
// upload URL rather than accepting the file bytes itself. Product photos run
// several MB (see lib/image.ts) which can exceed Vercel serverless
// functions' request-body cap -- routing the actual upload straight from the
// browser to Supabase Storage (ImageUploadField.tsx uses the returned
// token with the client-side anon-key client) sidesteps that limit entirely.
// Body: { filename: string }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const filename = typeof body.filename === 'string' ? body.filename : ''
    const ext = (filename.split('.').pop() ?? '').toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WebP, or GIF images are allowed' }, { status: 400 })
    }

    const path = `${randomUUID()}.${ext}`

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true, path, token: 'mock', publicUrl: `https://example.com/${path}` })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const { data, error } = await db.storage.from('product-images').createSignedUploadUrl(path)
    if (error) throw error

    const { data: publicUrlData } = db.storage.from('product-images').getPublicUrl(path)

    return NextResponse.json({ path: data.path, token: data.token, publicUrl: publicUrlData.publicUrl })
  } catch (err) {
    console.error('[admin/products/upload-image POST] error:', err)
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 })
  }
}
