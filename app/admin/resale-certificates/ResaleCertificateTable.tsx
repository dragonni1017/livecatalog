'use client'

import { useState } from 'react'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import {
  certStatusClasses,
  certStatusLabel,
  type ResaleCertificate,
  type ResaleCertStatus,
} from '@/lib/resale-certificates'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  // Date-only values (expires_on) are parsed as UTC; format them in UTC too
  // so a US timezone doesn't show the day before.
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: iso.length === 10 ? 'UTC' : undefined,
  })
}

export default function ResaleCertificateTable({ initialCertificates }: { initialCertificates: ResaleCertificate[] }) {
  const [certs, setCerts] = useState(initialCertificates)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function setStatus(cert: ResaleCertificate, status: ResaleCertStatus) {
    let reviewNotes = ''
    if (status === 'rejected') {
      const reason = window.prompt('Reason for rejecting (kept on the record):', '')
      if (reason === null) return
      reviewNotes = reason
    }
    setBusyId(cert.id)
    setError(null)
    try {
      const res = await fetch('/admin/api/resale-certificates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cert.id, status, review_notes: reviewNotes }),
      })
      const err = await readApiError(res, 'Failed to update the certificate.')
      if (err) {
        setError(err)
        return
      }
      const { certificate } = (await res.json()) as { certificate: ResaleCertificate }
      setCerts((prev) => prev.map((c) => (c.id === certificate.id ? certificate : c)))
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusyId(null)
    }
  }

  if (certs.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
        No certificates uploaded yet. Customers add them on their account page.
      </div>
    )
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">State / permit</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Uploaded</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {certs.map((c) => (
              <tr key={c.id} className={c.replaced_at ? 'bg-gray-50 text-gray-400' : undefined}>
                <td className="px-4 py-3">
                  <div className="text-gray-900">{c.email}</div>
                  {c.replaced_at && <div className="text-xs">Replaced {formatDate(c.replaced_at)}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium">{c.state}</span>{' '}
                  <span className="font-mono">{c.permit_number}</span>
                </td>
                <td className="px-4 py-3">
                  {c.expires_on ? formatDate(c.expires_on) : 'No expiry'}
                  {c.reminder_sent_at && <div className="text-xs text-gray-400">Reminder sent {formatDate(c.reminder_sent_at)}</div>}
                  {c.expired_notice_sent_at && <div className="text-xs text-gray-400">Expired notice sent {formatDate(c.expired_notice_sent_at)}</div>}
                </td>
                <td className="px-4 py-3">{formatDate(c.created_at)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${certStatusClasses(c)}`}>
                    {certStatusLabel(c)}
                  </span>
                  {c.reviewed_by && (
                    <div className="mt-1 text-xs text-gray-400">
                      by {c.reviewed_by}
                      {c.review_notes ? `: ${c.review_notes}` : ''}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2 whitespace-nowrap">
                    <a
                      href={`/admin/api/resale-certificates/${c.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-gray-400"
                    >
                      View
                    </a>
                    {!c.replaced_at && c.status !== 'verified' && (
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => setStatus(c, 'verified')}
                        className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Verify
                      </button>
                    )}
                    {!c.replaced_at && c.status !== 'rejected' && (
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => setStatus(c, 'rejected')}
                        className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:border-red-400 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    )}
                    {!c.replaced_at && c.status !== 'pending' && (
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => setStatus(c, 'pending')}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:border-gray-400 disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
