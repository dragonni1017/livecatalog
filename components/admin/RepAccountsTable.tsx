'use client'

import { useState } from 'react'
import Link from 'next/link'

interface RepAccount {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  banned_until: string | null
}

function isActive(rep: RepAccount): boolean {
  if (!rep.banned_until) return true
  return new Date(rep.banned_until).getTime() < Date.now()
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function RepAccountsTable({
  initialReps,
  loadError,
}: {
  initialReps: RepAccount[]
  loadError: boolean
}) {
  const [reps, setReps] = useState<RepAccount[]>(initialReps)
  const [adding, setAdding] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSaving, setAddSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleAdd() {
    setAddError(null)
    if (!email.trim()) {
      setAddError('Email is required.')
      return
    }
    if (password.length < 8) {
      setAddError('Password must be at least 8 characters.')
      return
    }
    setAddSaving(true)
    try {
      const res = await fetch('/admin/api/rep-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const json = await res.json()
      if (!res.ok) {
        setAddError(json.error ?? 'Failed to create rep account.')
        return
      }
      setReps((prev) => [...prev, json.rep as RepAccount].sort((a, b) => a.email.localeCompare(b.email)))
      setAdding(false)
      setEmail('')
      setPassword('')
    } catch {
      setAddError('Network error. Please try again.')
    } finally {
      setAddSaving(false)
    }
  }

  async function handleToggleActive(rep: RepAccount) {
    setBusyId(rep.id)
    const nextActive = !isActive(rep)
    try {
      const res = await fetch('/admin/api/rep-accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rep.id, active: nextActive }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? 'Failed to update rep account.')
        return
      }
      setReps((prev) =>
        prev.map((r) =>
          r.id === rep.id
            ? { ...r, banned_until: nextActive ? null : new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString() }
            : r,
        ),
      )
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(rep: RepAccount) {
    if (!confirm(`Permanently delete rep account "${rep.email}"? This cannot be undone.`)) return
    setBusyId(rep.id)
    try {
      const res = await fetch(`/admin/api/rep-accounts?id=${encodeURIComponent(rep.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        alert(json.error ?? 'Failed to delete rep account.')
        return
      }
      setReps((prev) => prev.filter((r) => r.id !== rep.id))
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>

        <div className="flex items-start justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Rep Accounts</h1>
            <p className="text-sm text-gray-500 mt-1">
              Login accounts for /rep — reps browse the catalog and price orders at a selected tier.
            </p>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-shrink-0 ml-6">
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
              {reps.length} {reps.length === 1 ? 'rep' : 'reps'}
            </span>
            <button
              onClick={() => { setAdding(true); setEmail(''); setPassword(''); setAddError(null) }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
            >
              Add rep account
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load rep accounts. Check that SUPABASE_SERVICE_ROLE_KEY is set.
          </div>
        )}

        {adding && (
          <div className="mt-6 rounded-xl bg-white border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">New Rep Account</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="rep@ly-usa.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password <span className="text-red-500">*</span>
                  <span className="ml-1 text-xs font-normal text-gray-400">(min 8 characters)</span>
                </label>
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Choose a password"
                />
              </div>
            </div>
            {addError && <p className="mt-3 text-sm text-red-600">{addError}</p>}
            <p className="mt-3 text-xs text-gray-400">
              Share this password with the rep directly — it isn&apos;t emailed automatically.
              {' '}If 2FA is enabled (REP_TOTP_SECRET set), they scan the QR at{' '}
              <code className="font-mono">/rep/2fa-setup</code> after their first login.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={handleAdd}
                disabled={addSaving}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {addSaving ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => { setAdding(false); setAddError(null) }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          {reps.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-gray-500">No rep accounts yet. Add one above to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Last login</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reps.map((rep) => {
                    const active = isActive(rep)
                    const busy = busyId === rep.id
                    return (
                      <tr key={rep.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{rep.email}</td>
                        <td className="px-4 py-3">
                          {active ? (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                              Deactivated
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(rep.created_at)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(rep.last_sign_in_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleToggleActive(rep)}
                              disabled={busy}
                              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                              {busy ? '…' : active ? 'Deactivate' : 'Reactivate'}
                            </button>
                            <button
                              onClick={() => handleDelete(rep)}
                              disabled={busy}
                              className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
