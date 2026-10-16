import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { RESALE_CERT_BUCKET } from '@/lib/resale-certificates'

export const dynamic = 'force-dynamic'

// GET → redirect to a 5-minute signed URL for the certificate file. Under
// /admin, so middleware.ts already requires the admin role. The bucket is
// private: this short-lived link is the only way to open a file.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getAdminClient()
  const { data: cert } = await db.from('resale_certificates').select('file_path').eq('id', id).maybeSingle()
  if (!cert) return NextResponse.json({ error: 'Certificate not found.' }, { status: 404 })

  const { data, error } = await db.storage.from(RESALE_CERT_BUCKET).createSignedUrl(cert.file_path, 300)
  if (error || !data) {
    console.error('[admin/resale-certificates file]', error?.message)
    return NextResponse.json({ error: 'Could not open the file.' }, { status: 500 })
  }
  return NextResponse.redirect(data.signedUrl)
}
