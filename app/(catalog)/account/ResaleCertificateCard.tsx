'use client'

import { useRef, useState } from 'react'
import { getAuthClient } from '@/lib/auth-client'
import {
  RESALE_CERT_BUCKET,
  RESALE_CERT_MAX_BYTES,
  RESALE_CERT_TYPES,
  US_STATES,
  certStatusClasses,
  certStatusLabel,
  type ResaleCertificate,
} from '@/lib/resale-certificates'

export type CustomerCertificate = Pick<
  ResaleCertificate,
  'id' | 'file_name' | 'state' | 'permit_number' | 'expires_on' | 'status' | 'review_notes' | 'created_at'
>

const ACCEPT = Object.keys(RESALE_CERT_TYPES).map((e) => `.${e}`).join(',')

function formatDay(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    return typeof body?.error === 'string' ? body.error : fallback
  } catch {
    return fallback
  }
}

export default function ResaleCertificateCard({ initial }: { initial: CustomerCertificate | null }) {
  const [cert, setCert] = useState(initial)
  const [editing, setEditing] = useState(!initial)
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState('')
  const [permitNumber, setPermitNumber] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function pickFile(f: File | undefined) {
    setError(null)
    if (!f) return setFile(null)
    const ext = (f.name.split('.').pop() ?? '').toLowerCase()
    if (!RESALE_CERT_TYPES[ext]) {
      setError('Upload a PDF, JPG, or PNG file.')
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    if (f.size > RESALE_CERT_MAX_BYTES) {
      setError('The file is larger than 10 MB.')
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setFile(f)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return setError('Choose your certificate file.')
    if (!state) return setError('Choose the state that issued the certificate.')
    if (!permitNumber.trim()) return setError('Enter the permit or certificate number.')

    setSaving(true)
    setError(null)
    try {
      const prepRes = await fetch('/api/account/resale-certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', filename: file.name }),
      })
      if (!prepRes.ok) throw new Error(await errorFrom(prepRes, 'Could not prepare the upload.'))
      const prep = (await prepRes.json()) as { path: string; token: string }

      const ext = (file.name.split('.').pop() ?? '').toLowerCase()
      const { error: uploadError } = await getAuthClient()
        .storage.from(RESALE_CERT_BUCKET)
        .uploadToSignedUrl(prep.path, prep.token, file, { contentType: RESALE_CERT_TYPES[ext] })
      if (uploadError) throw new Error('The upload failed. Please try again.')

      const saveRes = await fetch('/api/account/resale-certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          path: prep.path,
          fileName: file.name,
          state,
          permitNumber: permitNumber.trim(),
          expiresOn: expiresOn || undefined,
        }),
      })
      if (!saveRes.ok) throw new Error(await errorFrom(saveRes, 'Could not save your certificate.'))
      const { certificate } = (await saveRes.json()) as { certificate: CustomerCertificate }

      setCert(certificate)
      setEditing(false)
      setFile(null)
      setState('')
      setPermitNumber('')
      setExpiresOn('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">Resale Certificate</h2>
      <p className="mb-4 text-sm text-gray-500">
        Buying for resale? Upload your state resale or tax-exempt certificate so we can keep it on file with your orders.
      </p>

      {cert && (
        <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900">
              {cert.state} · <span className="font-mono">{cert.permit_number}</span>
            </span>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${certStatusClasses(cert)}`}>
              {certStatusLabel(cert)}
            </span>
          </div>
          <p className="mt-1 text-gray-500">
            {cert.file_name ?? 'Certificate file'} · uploaded {formatDay(cert.created_at)}
            {cert.expires_on ? ` · expires ${formatDay(cert.expires_on)}` : ''}
          </p>
          {cert.status === 'rejected' && cert.review_notes && (
            <p className="mt-1 text-red-700">Note from our team: {cert.review_notes}</p>
          )}
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 hover:text-gray-900"
            >
              Upload a new certificate
            </button>
          )}
        </div>
      )}

      {editing && (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="cert-file">
              Certificate file (PDF, JPG, or PNG, up to 10 MB) *
            </label>
            <input
              ref={inputRef}
              id="cert-file"
              type="file"
              accept={ACCEPT}
              onChange={(e) => pickFile(e.target.files?.[0])}
              className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="cert-state">
                Issuing state *
              </label>
              <select
                id="cert-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Choose…</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="cert-permit">
                Permit / certificate number *
              </label>
              <input
                id="cert-permit"
                value={permitNumber}
                maxLength={64}
                onChange={(e) => setPermitNumber(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="cert-expires">
                Expiration date (if any)
              </label>
              <input
                id="cert-expires"
                type="date"
                value={expiresOn}
                onChange={(e) => setExpiresOn(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? 'Uploading…' : 'Upload certificate'}
            </button>
            {cert && !saving && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setError(null)
                }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
