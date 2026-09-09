'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

type Role = 'customer' | 'rep' | 'admin'
type RoleFilter = 'all' | Role

export interface UserAccount {
  id: string
  email: string
  role: Role
  name: string | null
  company: string | null
  emailConfirmed: boolean
  createdAt: string
  lastSignInAt: string | null
  bannedUntil: string | null
}

function isActive(account: UserAccount): boolean {
  if (!account.bannedUntil) return true
  return new Date(account.bannedUntil).getTime() < Date.now()
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const ROLE_LABEL: Record<Role, string> = { customer: 'customer', rep: 'rep', admin: 'admin' }

export default function UsersTable({
  initialAccounts,
  loadError,
  currentUserId,
}: {
  initialAccounts: UserAccount[]
  loadError: boolean
  currentUserId: string | null
}) {
  const [accounts, setAccounts] = useState<UserAccount[]>(initialAccounts)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null)
  const [emailDraft, setEmailDraft] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  // Every handler below used `await res.json()` before checking res.ok, so any
  // non-JSON response threw and was caught as "Network error" — which is what
  // an expired admin session looked like, because middleware used to redirect
  // API calls to the HTML login page. Read the body defensively and name the
  // failure instead of blaming the network.
  async function readError(res: Response, fallback: string): Promise<string | null> {
    if (res.status === 401) {
      return 'Your admin session has expired. Reload the page, sign in again, and retry.'
    }
    let body: unknown = null
    try {
      // clone() so callers that need the success payload (create_account) can
      // still read it — a Response body can only be consumed once.
      body = await res.clone().json()
    } catch {
      // Not JSON — an error page, a proxy response, or an empty body.
      return res.ok ? null : `${fallback} (server returned ${res.status})`
    }
    if (res.ok) return null
    const message = (body as { error?: string })?.error
    return message ?? `${fallback} (server returned ${res.status})`
  }

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(id)
    try {
      const res = await fetch('/admin/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      const err = await readError(res, 'Failed to update account.')
      if (err) {
        alert(err)
        return false
      }
      return true
    } catch {
      alert("Couldn't reach the server. Check your connection and try again.")
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function handleRoleChange(account: UserAccount, nextRole: Role) {
    if (nextRole === account.role) return
    const isSelf = account.id === currentUserId
    const message = isSelf
      ? `You are about to change your OWN role from ${account.role} to ${nextRole}. If you remove your admin access you could be locked out of this panel. Continue?`
      : `Change "${account.email}" from ${account.role} to ${nextRole}? ${
          nextRole === 'admin'
            ? 'This grants full admin-panel and QuickBooks order-approval access.'
            : nextRole === 'rep'
              ? 'This grants /rep access.'
              : 'This revokes any staff (admin/rep) access.'
        }`
    if (!confirm(message)) return

    const ok = await patch(account.id, { role: nextRole })
    if (ok) {
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, role: nextRole } : a)))
    }
  }

  async function handleToggleActive(account: UserAccount) {
    const nextActive = !isActive(account)
    const ok = await patch(account.id, { active: nextActive })
    if (ok) {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === account.id
            ? { ...a, bannedUntil: nextActive ? null : new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString() }
            : a,
        ),
      )
    }
  }

  function startEditEmail(account: UserAccount) {
    setEditingEmailId(account.id)
    setEmailDraft(account.email)
  }

  async function handleSaveEmail(account: UserAccount) {
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

  async function handleSendPasswordReset(account: UserAccount) {
    if (!confirm(`Send a password reset email to "${account.email}"?`)) return
    setBusyId(account.id)
    try {
      const res = await fetch('/admin/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: account.id, action: 'send_password_reset' }),
      })
      const err = await readError(res, 'Failed to send password reset.')
      if (err) {
        alert(err)
        return
      }
      alert(`Password reset email sent to ${account.email}.`)
    } catch {
      alert("Couldn't reach the server. Check your connection and try again.")
    } finally {
      setBusyId(null)
    }
  }

  // Email-free alternative to the reset mail above. Supabase Auth email is
  // rate-limited per project and confirmation is required at signup, so a
  // customer who can't receive mail has no way in on their own — this is the
  // "read them a temporary password over the phone" path.
  async function handleSetPassword(account: UserAccount) {
    const password = prompt(
      `Set a new password for "${account.email}".\n\nThey can change it later under Account → Settings. No email is sent, and this also confirms the address if it was still pending.\n\nMinimum 8 characters:`,
    )
    if (password === null) return
    if (password.length < 8) {
      alert('Password must be at least 8 characters.')
      return
    }

    setBusyId(account.id)
    try {
      const res = await fetch('/admin/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: account.id, action: 'set_password', password }),
      })
      const err = await readError(res, 'Failed to set password.')
      if (err) {
        alert(err)
        return
      }
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, emailConfirmed: true } : a)),
      )
      alert(`Password set for ${account.email}. They can sign in with it now.`)
    } catch {
      alert("Couldn't reach the server. Check your connection and try again.")
    } finally {
      setBusyId(null)
    }
  }

  async function handleCreateAccount() {
    const email = prompt('Email address for the new customer account:')
    if (email === null) return
    if (!email.trim()) {
      alert('Email is required.')
      return
    }
    const password = prompt(
      `Password for "${email.trim()}" (minimum 8 characters).\n\nThe account is created already confirmed, so no signup email is sent — this avoids the confirmation mail and its rate limit entirely.`,
    )
    if (password === null) return
    if (password.length < 8) {
      alert('Password must be at least 8 characters.')
      return
    }

    setCreating(true)
    try {
      const res = await fetch('/admin/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_account', email: email.trim(), password }),
      })
      const err = await readError(res, 'Failed to create account.')
      if (err) {
        alert(err)
        return
      }
      const json = await res.json()
      setAccounts((prev) => [json.account as UserAccount, ...prev])
      alert(`Account created for ${json.account.email}. They can sign in immediately.`)
    } catch {
      alert("Couldn't reach the server. Check your connection and try again.")
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(account: UserAccount) {
    const survives =
      account.role === 'customer'
        ? 'Their order history will remain intact and stay searchable by email — only their login is removed.'
        : account.role === 'rep'
          ? "Their order history will remain intact, but if they're attributed to any existing orders this delete will FAIL (foreign key) — deactivate them instead in that case."
          : 'Any orders they approved stay keyed into QuickBooks and untouched — only their login is removed.'
    if (
      !confirm(
        `Permanently delete account "${account.email}" (${account.role})? This cannot be undone. ${survives}`,
      )
    )
      return
    setBusyId(account.id)
    try {
      const res = await fetch(`/admin/api/users?id=${encodeURIComponent(account.id)}`, { method: 'DELETE' })
      const err = await readError(res, 'Failed to delete account.')
      if (err) {
        alert(err)
        return
      }
      setAccounts((prev) => prev.filter((a) => a.id !== account.id))
    } catch {
      alert("Couldn't reach the server. Check your connection and try again.")
    } finally {
      setBusyId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accounts.filter((a) => {
      if (roleFilter !== 'all' && a.role !== roleFilter) return false
      if (!q) return true
      return (
        a.email.toLowerCase().includes(q) ||
        (a.name ?? '').toLowerCase().includes(q) ||
        (a.company ?? '').toLowerCase().includes(q)
      )
    })
  }, [accounts, roleFilter, search])

  const counts = useMemo(() => {
    const c = { all: accounts.length, customer: 0, rep: 0, admin: 0 }
    for (const a of accounts) c[a.role]++
    return c
  }, [accounts])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-10">
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
            <h1 className="text-2xl font-bold text-gray-900">Users</h1>
            <p className="text-sm text-gray-500 mt-1">
              Every registered account — customers, reps, and admins. Edit, deactivate, or delete here.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600 mt-1 flex-shrink-0 ml-6">
            {filtered.length} of {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
          </span>
        </div>

        {loadError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load users. Check that SUPABASE_SERVICE_ROLE_KEY is set.
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-gray-300 bg-white p-1 text-sm">
            {(['all', 'customer', 'rep', 'admin'] as RoleFilter[]).map((r) => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  roleFilter === r ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {r === 'all' ? 'All' : r === 'customer' ? 'Customers' : r === 'rep' ? 'Reps' : 'Admins'} (
                {r === 'all' ? counts.all : counts[r]})
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email, name, or company…"
            className="flex-1 min-w-[220px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <button
            onClick={handleCreateAccount}
            disabled={creating}
            title="Creates a pre-confirmed account — no signup email, so it can't hit the email rate limit"
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            {creating ? 'Creating…' : '+ Create account'}
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-gray-500">
                {accounts.length === 0 ? 'No registered users yet.' : 'No accounts match this filter.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Name / Company</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Confirmed</th>
                    <th className="px-4 py-3">Signed up</th>
                    <th className="px-4 py-3">Last login</th>
                    {/* Pinned to the right edge. This table is 8 columns wide
                        and scrolls horizontally, so on a laptop the actions —
                        including Delete — used to sit off-screen with nothing
                        indicating they were there. */}
                    <th className="sticky right-0 z-10 bg-gray-50 px-4 py-3 text-right border-l border-gray-200 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((account) => {
                    const active = isActive(account)
                    const busy = busyId === account.id
                    const isSelf = account.id === currentUserId
                    const editingEmail = editingEmailId === account.id
                    return (
                      <tr key={account.id} className="group hover:bg-gray-50 transition-colors">
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
                              {isSelf && <span className="text-xs font-normal text-gray-400">(you)</span>}
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
                        <td className="px-4 py-3 text-gray-600">
                          {account.name || account.company ? (
                            <div>
                              {account.name && <div>{account.name}</div>}
                              {account.company && <div className="text-xs text-gray-400">{account.company}</div>}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={account.role}
                            disabled={busy}
                            onChange={(e) => handleRoleChange(account, e.target.value as Role)}
                            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                          >
                            <option value="customer">{ROLE_LABEL.customer}</option>
                            <option value="rep">{ROLE_LABEL.rep}</option>
                            <option value="admin">{ROLE_LABEL.admin}</option>
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
                        <td className="px-4 py-3">
                          {account.emailConfirmed ? (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                              Confirmed
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(account.createdAt)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(account.lastSignInAt)}</td>
                        {/* Opaque background is required, not decorative: a
                            transparent sticky cell lets the scrolled columns
                            show through underneath it. Tracks the row's hover
                            state via the `group` on <tr>. */}
                        <td className="sticky right-0 z-10 bg-white group-hover:bg-gray-50 transition-colors px-4 py-3 border-l border-gray-200 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">
                          {/* Stays wrapped: five buttons on one line would make
                              the pinned column wide enough to cover most of the
                              table on a laptop. Wrapping trades height for
                              width, which is the right way round here. */}
                          <div className="flex flex-wrap items-center justify-end gap-2 max-w-[260px] ml-auto">
                            {account.email && (
                              <Link
                                href={`/admin/orders?email=${encodeURIComponent(account.email)}`}
                                className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                              >
                                View orders →
                              </Link>
                            )}
                            <button
                              onClick={() => handleSendPasswordReset(account)}
                              disabled={busy}
                              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                              {busy ? '…' : 'Send reset'}
                            </button>
                            <button
                              onClick={() => handleSetPassword(account)}
                              disabled={busy}
                              title="Set a password directly and confirm the address — no email involved"
                              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                              {busy ? '…' : 'Set password'}
                            </button>
                            <button
                              onClick={() => handleToggleActive(account)}
                              disabled={busy || isSelf}
                              title={isSelf ? "You can't deactivate your own account." : undefined}
                              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                              {busy ? '…' : active ? 'Deactivate' : 'Reactivate'}
                            </button>
                            <button
                              onClick={() => handleDelete(account)}
                              disabled={busy || isSelf}
                              title={isSelf ? "You can't delete your own account." : undefined}
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
