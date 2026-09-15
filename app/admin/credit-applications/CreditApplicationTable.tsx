'use client'

import { Fragment, useState } from 'react'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'

export interface CreditApplication {
  id: string
  company_name: string
  contact_name: string
  email: string
  phone: string | null
  address: string | null
  years_in_business: string | null
  annual_purchase_estimate: string | null
  requested_terms: string
  trade_references: string | null
  notes: string | null
  status: string
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  review_notes: string | null
  approved_terms: string | null
}

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  denied:   'bg-red-100 text-red-700',
}

const STATUS_LABEL: Record<string, string> = {
  pending:  'Pending',
  approved: 'Approved',
  denied:   'Declined',
}

const TERMS_LABEL: Record<string, string> = {
  'net-30': 'Net 30',
  'net-60': 'Net 60',
}

const FILTERS = [
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'denied',   label: 'Declined' },
  { key: 'all',      label: 'All' },
] as const

type Decision = 'approved' | 'denied'

function termsLabel(value: string | null): string {
  if (!value) return '—'
  return TERMS_LABEL[value] ?? value
}

export default function CreditApplicationTable({ initialApplications }: { initialApplications: CreditApplication[] }) {
  const [applications, setApplications] = useState(initialApplications)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>(
    initialApplications.some((a) => a.status === 'pending') ? 'pending' : 'all',
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // The in-progress decision, if any: approve or decline on the expanded
  // row, plus the terms/note/notify choices that go with it.
  const [decision, setDecision] = useState<Decision | null>(null)
  const [decisionTerms, setDecisionTerms] = useState('net-30')
  const [decisionNote, setDecisionNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const rows = filter === 'all' ? applications : applications.filter((a) => a.status === filter)
  const pendingCount = applications.filter((a) => a.status === 'pending').length

  function toggleRow(app: CreditApplication) {
    setError(null)
    setDecision(null)
    setExpandedId((prev) => (prev === app.id ? null : app.id))
  }

  function startDecision(app: CreditApplication, next: Decision) {
    setError(null)
    setFlash(null)
    setExpandedId(app.id)
    setDecision(next)
    setDecisionTerms(app.requested_terms)
    setDecisionNote('')
    setNotify(true)
  }

  async function submit(app: CreditApplication, status: Decision | 'pending') {
    setError(null)
    setFlash(null)
    setSaving(true)
    try {
      const res = await fetch('/admin/api/credit-applications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: app.id,
          status,
          ...(status === 'approved' ? { approved_terms: decisionTerms } : {}),
          ...(status === 'pending' ? {} : { review_notes: decisionNote, notify }),
        }),
      })
      const err = await readApiError(res, 'Failed to save the decision.')
      if (err) {
        setError(err)
        return
      }
      const json = await res.json()
      if (json.application) {
        setApplications((prev) => prev.map((a) => (a.id === app.id ? (json.application as CreditApplication) : a)))
      }
      setDecision(null)
      if (status === 'pending') {
        setFlash(`${app.company_name} reopened — back to pending review.`)
      } else {
        const what = status === 'approved'
          ? `approved for ${termsLabel(json.application?.approved_terms ?? decisionTerms)}`
          : 'declined'
        setFlash(
          json.emailError
            ? `${app.company_name} ${what}. ${json.emailError}`
            : `${app.company_name} ${what}.${json.emailed ? ' The applicant has been emailed.' : ' No email was sent.'}`,
        )
      }
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? applications.length : applications.filter((a) => a.status === f.key).length
          return (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setExpandedId(null); setDecision(null) }}
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                filter === f.key ? 'bg-gray-900 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f.label} ({count})
            </button>
          )
        })}
        {pendingCount > 0 && filter !== 'pending' && (
          <span className="text-sm font-medium text-amber-700">{pendingCount} awaiting review</span>
        )}
      </div>

      {flash && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">{flash}</div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center text-gray-500">
          {applications.length === 0
            ? 'No applications yet.'
            : `No ${filter === 'all' ? '' : (STATUS_LABEL[filter] ?? filter).toLowerCase() + ' '}applications.`}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Company</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Contact</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Terms</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Submitted</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((app) => {
                const isExpanded = expandedId === app.id
                const isDeciding = isExpanded && decision !== null
                return (
                  <Fragment key={app.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{app.company_name}</p>
                        {app.address && <p className="text-xs text-gray-400">{app.address}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-900">{app.contact_name}</p>
                        <p className="text-xs text-gray-500">{app.email}</p>
                        {app.phone && <p className="text-xs text-gray-400">{app.phone}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        <p className="font-medium">{termsLabel(app.requested_terms)}</p>
                        {app.status === 'approved' && app.approved_terms && app.approved_terms !== app.requested_terms && (
                          <p className="text-xs text-green-700">approved: {termsLabel(app.approved_terms)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[app.status] ?? 'bg-gray-100 text-gray-700'}`}>
                          {STATUS_LABEL[app.status] ?? app.status}
                        </span>
                        {app.reviewed_at && (
                          <p className="mt-0.5 text-xs text-gray-400">
                            {new Date(app.reviewed_at).toLocaleDateString()}
                            {app.reviewed_by ? ` · ${app.reviewed_by}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{new Date(app.created_at).toLocaleDateString()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {app.status === 'pending' ? (
                          <>
                            <button
                              onClick={() => startDecision(app, 'approved')}
                              className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => startDecision(app, 'denied')}
                              className="ml-2 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                            >
                              Decline
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => submit(app, 'pending')}
                            disabled={saving}
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Reopen
                          </button>
                        )}
                        <button
                          onClick={() => toggleRow(app)}
                          className="ml-2 text-xs text-gray-500 hover:text-gray-800"
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                            <div>
                              <span className="text-xs text-gray-500">Years in business</span>
                              <p>{app.years_in_business || '—'}</p>
                            </div>
                            <div>
                              <span className="text-xs text-gray-500">Est. annual purchases</span>
                              <p>{app.annual_purchase_estimate || '—'}</p>
                            </div>
                            <div>
                              <span className="text-xs text-gray-500">Requested terms</span>
                              <p>{termsLabel(app.requested_terms)}</p>
                            </div>
                            <div className="col-span-2 sm:col-span-3">
                              <span className="text-xs text-gray-500">Trade references</span>
                              <p className="whitespace-pre-wrap">{app.trade_references || '(none provided)'}</p>
                            </div>
                            {app.notes && (
                              <div className="col-span-2 sm:col-span-3">
                                <span className="text-xs text-gray-500">Applicant notes</span>
                                <p className="whitespace-pre-wrap">{app.notes}</p>
                              </div>
                            )}
                            {app.review_notes && (
                              <div className="col-span-2 sm:col-span-3">
                                <span className="text-xs text-gray-500">
                                  Review note{app.reviewed_by ? ` — ${app.reviewed_by}` : ''}
                                </span>
                                <p className="whitespace-pre-wrap">{app.review_notes}</p>
                              </div>
                            )}
                          </div>

                          {isDeciding && (
                            <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                              <p className="font-semibold text-gray-900">
                                {decision === 'approved' ? `Approve ${app.company_name}` : `Decline ${app.company_name}`}
                              </p>

                              {decision === 'approved' && (
                                <label className="mt-3 block text-sm">
                                  <span className="text-xs font-medium text-gray-600">Approved terms</span>
                                  <select
                                    value={decisionTerms}
                                    onChange={(e) => setDecisionTerms(e.target.value)}
                                    className="mt-1 block rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                                  >
                                    <option value="net-30">Net 30</option>
                                    <option value="net-60">Net 60</option>
                                  </select>
                                  {decisionTerms !== app.requested_terms && (
                                    <span className="mt-1 block text-xs text-amber-700">
                                      Different from the {termsLabel(app.requested_terms)} they requested — the email will say so.
                                    </span>
                                  )}
                                </label>
                              )}

                              <label className="mt-3 block text-sm">
                                <span className="text-xs font-medium text-gray-600">
                                  Note to the applicant (optional — included in the email)
                                </span>
                                <textarea
                                  value={decisionNote}
                                  onChange={(e) => setDecisionNote(e.target.value)}
                                  rows={3}
                                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                  placeholder={decision === 'approved'
                                    ? 'e.g. Terms start with your next order; credit limit $5,000.'
                                    : 'e.g. Happy to revisit after six months of prepaid orders.'}
                                />
                              </label>

                              <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
                                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                                Email {app.email}
                              </label>

                              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

                              <div className="mt-4 flex gap-2">
                                <button
                                  onClick={() => submit(app, decision)}
                                  disabled={saving}
                                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                                    decision === 'approved' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                                  }`}
                                >
                                  {saving
                                    ? 'Saving…'
                                    : decision === 'approved'
                                      ? `Approve for ${termsLabel(decisionTerms)}`
                                      : 'Confirm decline'}
                                </button>
                                <button
                                  onClick={() => setDecision(null)}
                                  disabled={saving}
                                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {!isDeciding && error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
