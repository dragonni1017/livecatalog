'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface PullState {
  status: 'idle' | 'requested' | 'in_progress' | 'done' | 'error'
  pulled_count: number
  error_message: string | null
  requested_at: string | null
  completed_at: string | null
}

interface Buyer {
  email: string
  name: string
  company: string | null
  lastOrderAt: string
  link: { qb_customer_list_id: string | null; qb_customer_full_name: string | null; last_sync_source: string | null } | null
}

interface DirectoryMatch {
  qb_customer_list_id: string
  full_name: string
  company_name: string | null
  email: string | null
  phone: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const PULL_LABEL: Record<PullState['status'], string> = {
  idle: 'Never pulled',
  requested: 'Requested — waiting for Web Connector’s next poll',
  in_progress: 'Pulling…',
  done: 'Done',
  error: 'Failed',
}

export default function QbCustomerMatcher({
  initialPull,
  initialDirectoryCount,
  initialBuyers,
}: {
  initialPull: PullState
  initialDirectoryCount: number
  initialBuyers: Buyer[]
}) {
  const [pull, setPull] = useState(initialPull)
  const [directoryCount, setDirectoryCount] = useState(initialDirectoryCount)
  const [buyers, setBuyers] = useState(initialBuyers)
  const [requesting, setRequesting] = useState(false)
  const [searchingEmail, setSearchingEmail] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<DirectoryMatch[]>([])
  const [linking, setLinking] = useState<string | null>(null)

  const polling = pull.status === 'requested' || pull.status === 'in_progress'

  // Poll pull status every 5s while a pull is active — the actual work only
  // happens when QuickBooks Web Connector next calls in, so this is just
  // reflecting DB state, not driving anything itself.
  useEffect(() => {
    if (!polling) return
    const id = setInterval(async () => {
      try {
        const res = await fetch('/admin/api/qbwc/customer-pull')
        const json = await res.json()
        if (res.ok) {
          setPull(json.pull)
          setDirectoryCount(json.directoryCount)
        }
      } catch {
        /* transient — next tick retries */
      }
    }, 5000)
    return () => clearInterval(id)
  }, [polling])

  async function handlePullNow() {
    setRequesting(true)
    try {
      const res = await fetch('/admin/api/qbwc/customer-pull', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? 'Failed to request pull.')
        return
      }
      setPull((p) => ({ ...p, status: 'requested', error_message: null }))
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setRequesting(false)
    }
  }

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleQueryChange(value: string) {
    setQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!value.trim()) {
      setMatches([])
      return
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/admin/api/qbwc/customer-directory?q=${encodeURIComponent(value)}`)
        const json = await res.json()
        if (res.ok) setMatches(json.customers)
      } catch {
        /* ignore — user can retype */
      }
    }, 300)
  }

  function startSearch(email: string) {
    setSearchingEmail(email)
    setQuery('')
    setMatches([])
  }

  async function handleLink(email: string, match: DirectoryMatch) {
    setLinking(email)
    try {
      const res = await fetch('/admin/api/qbwc/customer-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, qb_customer_list_id: match.qb_customer_list_id, qb_customer_full_name: match.full_name }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? 'Failed to link.')
        return
      }
      setBuyers((prev) =>
        prev.map((b) =>
          b.email === email
            ? { ...b, link: { qb_customer_list_id: match.qb_customer_list_id, qb_customer_full_name: match.full_name, last_sync_source: 'manual' } }
            : b,
        ),
      )
      setSearchingEmail(null)
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setLinking(null)
    }
  }

  async function handleUnlink(email: string) {
    if (!confirm(`Remove the QuickBooks link for "${email}"? Their next order will fall back to a name-based lookup (may auto-create a new customer).`)) return
    setLinking(email)
    try {
      const res = await fetch(`/admin/api/qbwc/customer-links?email=${encodeURIComponent(email)}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        alert(json.error ?? 'Failed to unlink.')
        return
      }
      setBuyers((prev) => prev.map((b) => (b.email === email ? { ...b, link: null } : b)))
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setLinking(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <Link href="/admin/quickbooks" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
          ← Back to QuickBooks setup
        </Link>

        <h1 className="mt-2 text-2xl font-bold text-gray-900">Link QuickBooks Customers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Match a buyer&apos;s email to their existing QuickBooks customer before their first order syncs.
          Auto-sync looks customers up by exact name (QuickBooks has no email lookup) — an unmatched name
          creates a brand-new customer instead, so linking known customers here first avoids duplicates.
        </p>

        {/* Pull status */}
        <div className="mt-6 rounded-xl bg-white border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">QuickBooks customer list</h2>
              <p className="mt-1 text-sm text-gray-700">
                {PULL_LABEL[pull.status]}
                {pull.status === 'error' && pull.error_message ? ` — ${pull.error_message}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                {directoryCount} customer{directoryCount === 1 ? '' : 's'} pulled
                {pull.completed_at ? ` · last completed ${formatDate(pull.completed_at)}` : ''}
              </p>
            </div>
            <button
              onClick={handlePullNow}
              disabled={requesting || polling}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {polling ? 'Pulling…' : requesting ? 'Requesting…' : 'Pull from QuickBooks'}
            </button>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            This only runs the next time QuickBooks Web Connector polls (up to its 15-minute interval,
            or trigger it manually from Web Connector&apos;s own &quot;Update Selected&quot; button) — this page
            just requests it and reflects progress.
          </p>
        </div>

        {/* Buyers */}
        <div className="mt-6 rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          <h2 className="px-5 pt-5 pb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Buyers ({buyers.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-5 py-2">Email</th>
                  <th className="px-3 py-2">Name / Company</th>
                  <th className="px-3 py-2">Last order</th>
                  <th className="px-3 py-2">QuickBooks link</th>
                  <th className="px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {buyers.map((b) => {
                  const busy = linking === b.email
                  const isSearching = searchingEmail === b.email
                  return (
                    <tr key={b.email} className="align-top">
                      <td className="px-5 py-3 text-gray-900">{b.email}</td>
                      <td className="px-3 py-3 text-gray-700">
                        {b.name}
                        {b.company ? <div className="text-xs text-gray-400">{b.company}</div> : null}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">{formatDate(b.lastOrderAt)}</td>
                      <td className="px-3 py-3">
                        {b.link ? (
                          <div>
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                              Linked
                            </span>
                            <div className="mt-1 text-xs text-gray-500">
                              {b.link.qb_customer_full_name}
                              {b.link.last_sync_source === 'manual' ? ' (manual)' : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">Not linked</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {isSearching ? (
                          <div className="text-left">
                            <input
                              autoFocus
                              type="text"
                              value={query}
                              onChange={(e) => handleQueryChange(e.target.value)}
                              placeholder="Search QuickBooks customers…"
                              className="w-56 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                            {matches.length > 0 && (
                              <ul className="mt-1 max-h-40 w-56 overflow-y-auto rounded border border-gray-200 bg-white shadow-sm">
                                {matches.map((m) => (
                                  <li key={m.qb_customer_list_id}>
                                    <button
                                      onClick={() => handleLink(b.email, m)}
                                      disabled={busy}
                                      className="block w-full px-2 py-1.5 text-left text-xs hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      <span className="font-medium text-gray-900">{m.full_name}</span>
                                      {m.company_name ? <span className="text-gray-400"> · {m.company_name}</span> : null}
                                      {m.email ? <div className="text-gray-400">{m.email}</div> : null}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <button
                              onClick={() => setSearchingEmail(null)}
                              className="mt-1 text-xs text-gray-400 hover:text-gray-600"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => startSearch(b.email)}
                              disabled={busy}
                              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                              {b.link ? 'Re-link' : 'Link'}
                            </button>
                            {b.link && (
                              <button
                                onClick={() => handleUnlink(b.email)}
                                disabled={busy}
                                className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                              >
                                {busy ? '…' : 'Unlink'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
