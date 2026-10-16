import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'
import { getAdminClient } from '@/lib/supabase'
import {
  RESALE_CERT_BUCKET,
  RESALE_CERT_MAX_BYTES,
  RESALE_CERT_TYPES,
  US_STATES,
  type ResaleCertificate,
} from '@/lib/resale-certificates'

export const dynamic = 'force-dynamic'

// A signed-in customer's own resale certificate. Every /api/* route is public
// (middleware only gates /admin and /rep), so the session check below is the
// only guard. Every read and write is scoped to the session user's id: a
// caller can never name another customer's row or file.
//
// Upload is two calls, like product photos: `prepare` mints a signed upload
// URL so the browser sends the file straight to the private bucket (avoids
// Vercel's 4.5 MB request cap), then `save` records it once the file is there.

// Only what the customer needs to see. file_path and review fields stay admin-side.
const CUSTOMER_FIELDS = 'id, file_name, state, permit_number, expires_on, status, review_notes, created_at'

async function requireUser() {
  const user = await getSessionUser()
  if (!user?.email) return null
  return { id: user.id, email: user.email.toLowerCase() }
}

// GET → { certificate } (the active one, or null)
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Sign in to manage your resale certificate.' }, { status: 401 })

  const db = getAdminClient()
  const { data, error } = await db
    .from('resale_certificates')
    .select(CUSTOMER_FIELDS)
    .eq('user_id', user.id)
    .is('replaced_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[account/resale-certificate GET]', error.message)
    return NextResponse.json({ error: 'Could not load your certificate.' }, { status: 500 })
  }
  return NextResponse.json({ certificate: data })
}

// POST { action: 'prepare', filename }
//   → { path, token }
// POST { action: 'save', path, fileName, state, permitNumber, expiresOn? }
//   → { certificate }
export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Sign in to upload a resale certificate.' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const db = getAdminClient()

  if (body.action === 'prepare') {
    const filename = typeof body.filename === 'string' ? body.filename : ''
    const ext = (filename.split('.').pop() ?? '').toLowerCase()
    if (!RESALE_CERT_TYPES[ext]) {
      return NextResponse.json({ error: 'Upload a PDF, JPG, or PNG file.' }, { status: 400 })
    }
    // The folder is the user's id, which is how `save` proves the file is theirs.
    const path = `${user.id}/${randomUUID()}.${ext}`
    const { data, error } = await db.storage.from(RESALE_CERT_BUCKET).createSignedUploadUrl(path)
    if (error || !data) {
      console.error('[account/resale-certificate prepare]', error?.message)
      return NextResponse.json({ error: 'Could not prepare the upload. Please try again.' }, { status: 500 })
    }
    return NextResponse.json({ path: data.path, token: data.token })
  }

  if (body.action === 'save') {
    const path = typeof body.path === 'string' ? body.path : ''
    const prefix = `${user.id}/`
    const objectName = path.slice(prefix.length)
    // Exactly '<own id>/<uuid>.<ext>', so no other folder and no '..' tricks.
    if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\.(pdf|jpe?g|png)$/.test(objectName)) {
      return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 })
    }

    const state = typeof body.state === 'string' ? body.state.trim().toUpperCase() : ''
    if (!(US_STATES as readonly string[]).includes(state)) {
      return NextResponse.json({ error: 'Choose the state that issued the certificate.' }, { status: 400 })
    }
    const permitNumber = typeof body.permitNumber === 'string' ? body.permitNumber.trim() : ''
    if (!permitNumber || permitNumber.length > 64) {
      return NextResponse.json({ error: 'Enter the permit or certificate number (up to 64 characters).' }, { status: 400 })
    }
    let expiresOn: string | null = null
    if (typeof body.expiresOn === 'string' && body.expiresOn.trim()) {
      expiresOn = body.expiresOn.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn!) || Number.isNaN(Date.parse(expiresOn!))) {
        return NextResponse.json({ error: 'Enter a valid expiration date.' }, { status: 400 })
      }
    }
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 200) || null : null

    // The signed upload URL only allowed this exact path, but confirm the
    // upload actually finished before recording it.
    const { data: listed, error: listError } = await db.storage
      .from(RESALE_CERT_BUCKET)
      .list(user.id, { search: objectName, limit: 1 })
    const object = listed?.find((o) => o.name === objectName)
    if (listError || !object) {
      return NextResponse.json({ error: 'The file did not finish uploading. Please try again.' }, { status: 400 })
    }
    const size = Number((object.metadata as { size?: number } | null)?.size ?? 0)
    if (size > RESALE_CERT_MAX_BYTES) {
      await db.storage.from(RESALE_CERT_BUCKET).remove([path])
      return NextResponse.json({ error: 'The file is larger than 10 MB.' }, { status: 400 })
    }

    const { data: inserted, error: insertError } = await db
      .from('resale_certificates')
      .insert({
        user_id: user.id,
        email: user.email,
        file_path: path,
        file_name: fileName,
        state,
        permit_number: permitNumber,
        expires_on: expiresOn,
      })
      .select(CUSTOMER_FIELDS)
      .single()
    if (insertError || !inserted) {
      console.error('[account/resale-certificate save]', insertError?.message)
      return NextResponse.json({ error: 'Could not save your certificate. Please try again.' }, { status: 500 })
    }

    // The new one becomes the active certificate; earlier ones stay as history.
    await db
      .from('resale_certificates')
      .update({ replaced_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('replaced_at', null)
      .neq('id', (inserted as Pick<ResaleCertificate, 'id'>).id)

    return NextResponse.json({ certificate: inserted })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
