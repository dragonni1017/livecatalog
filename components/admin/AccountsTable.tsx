'use client'

import { useState } from 'react'
import Link from 'next/link'

type Role = 'admin' | 'rep'

interface Account {
  id: string
  email: string
  role: Role
  created_at: string
  last_sign_in_at: string | null
  banned_until: string | null
}

function isActive(account: Account): boolean {
  if (!account.banned_until) return true
  return new Date(account.banned_until).getTime() < Date.now()
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AccountsTable({
  initialAccounts,
  loadError,
  currentUserId,
}: {
  initialAccounts: Account[]
  loadError: boolean
  currentUserId: string | null
}) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts)
  const [adding, setAdding] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('rep')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSaving, setAddSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null)
  const [emailDraft, setEmailDraft] = useState('')

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(id)
    try {
      const res = await fetch('/admin/api/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? 'Failed to update account.')
        return false
      }
      return true
    } catch {
      alert('Network error. Please try again.')
      return false
    } finally {
      setBusyId(null)
    }
  }

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
      const res = await fetch('/admin/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, role }),
      })
      const json = await res.json()
      if (!res.ok) {
        setAddError(json.error ?? 'Failed to create account.')
        return
      }
      setAccounts((prev) => [...prev, json.account as Account].sort((a, b) => a.email.localeCompare(b.email)))
      setAdding(false)
      setEmail('')
      setPassword('')
      setRole('rep')
    } catch {
      setAddError('Network error. Please try again.')
    } finally {
      setAddSaving(false)
    }
  }

  async function handleRoleChange(account: Account, nextRole: Role) {
    if (nextRole === account.role) return
    const goingToAdmin = nextRole === 'admin'
    const isSelf = account.id === currentUserId
    const message = isSelf
      ? `You are about to change your OWN role from ${account.role} to ${nextRole}. If you remove your admin access you could be locked out of this panel. Continue?`
      : `Change "${account.email}" from ${account.role} to ${nextRole}? ${goingToAdmin ? 'This grants full admin-panel and QuickBooks order-approval access.' : 'This revokes admin-panel access.'}`
    if (!confirm(message)) return

    const ok = await patch(account.id, { role: nextRole })
    if (ok) {
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, role: nextRole } : a)))
    }
  }

  async function handleToggleActive(account: Account) {
    const nextActive = !isActive(account)
    const ok = await patch(account.id, { active: nextActive })
    if (ok) {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === account.id
            ? { ...a, banned_until: nextActive ? null : new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString() }
            : a,
        ),
      )
    }
  }

  function startEditEmail(account: Account) {
    setEditingEmailId(account.id)
    setEmailDraft(account.email)
  }

  async function handleSaveEmail(account: Account) {
    const nextEmail = emailDraft.trim().toLowerCase()
    if (!nextEmail || nextEmail === account.email) {
      setEditingEmailId(null)
      return
    }
    const ok = await patch(account.id, { email: nextEmail })
    if (ok) {
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, email: nextEmail } : a)))
      setEditingEmailId(null)
    }
  }

  async function handleDelete(account: Account) {
    if (!confirm(`Permanently delete account "${account.email}" (${account.role})? This cannot be undone.`)) return
    setBusyId(account.id)
    try {
      const res = await fetch(`/admin/api/accounts?id=${encodeURIComponent(account.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        alert(json.error ?? 'Failed to delete account.')
        return
      }
      setAccounts((prev) => prev.filter((a) => a.id !== account.id))
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
            <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
            <p className="text-sm text-gray-500 mt-1">
              Login accounts for /admin and /rep — edit email, role, or access here.
            </p>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-shrink-0 ml-6">
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
              {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
            </span>
            <button
              onClick={() => { setAdding(true); setEmail(''); setPassword(''); setRole('rep'); setAddError(null) }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
            >
              Add account
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load accounts. Check that SUPABASE_SERVICE_ROLE_KEY is set.
          </div>
        )}

        {adding && (
          <div className="mt-6 rounded-xl bg-white border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">New Account</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="name@ly-usa.com"
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="rep">rep</option>
                  <option value="admin">admin</option>
                </select>
              </div>
            </div>
            {addError && <p className="mt-3 text-sm text-red-600">{addError}</p>}
            <p className="mt-3 text-xs text-gray-400">
              Share this password with them directly — it isn&apos;t emailed automatically.
              {' '}If 2FA is enabled (ADMIN_TOTP_SECRET / REP_TOTP_SECRET set), they scan the QR at{' '}
              <code className="font-mono">/{role}/2fa-setup</code> after their first login.
              {' '}If this email already has a registered customer account, that account is promoted to
              the selected role instead — its existing password is left alone (the password field above is
              ignored in that case).
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
          {accounts.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-gray-500">No accounts yet. Add one above to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Last login</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {accounts.map((account) => {
                    const active = isActive(account)
                    const busy = busyId === account.id
                    const isSelf = account.id === currentUserId
                    const editingEmail = editingEmailId === account.id
                    return (
                      <tr key={account.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {editingEmail ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="email"
                                value={emailDraft}
                                onChange={(e) => setEmailDraft(e.target.value)}
                                autoFocus
                                className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                              />
                              <button
                                onClick={() => handleSaveEmail(account)}
                                disabled={busy}
                                className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingEmailId(null)}
                                className="text-xs font-medium text-gray-500 hover:text-gray-700"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span>{account.email}</span>
                              {isSelf && (
                                <span className="text-xs font-normal text-gray-400">(you)</span>
                              )}
                              <button
                                onClick={() => startEditEmail(account)}
                                className="text-xs font-medium text-gray-400 hover:text-gray-600"
                                title="Edit email"
                              >
                                Edit
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={account.role}
                            disabled={busy}
                            onChange={(e) => handleRoleChange(account, e.target.value as Role)}
                            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                          >
                            <option value="rep">rep</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
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
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(account.created_at)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(account.last_sign_in_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleToggleActive(account)}
                              disabled={busy}
                              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                              {busy ? '…' : active ? 'Deactivate' : 'Reactivate'}
                            </button>
                            <button
                              onClick={() => handleDelete(account)}
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
