'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getAuthClient } from '@/lib/auth-client'

// Where a Supabase recovery email lands the customer.
//
// Supabase can hand back the recovery grant in three different shapes
// depending on the flow the client used and how the email template is
// written, and the old flow (/api/auth/callback) only understood one of
// them — every other shape redirected to a bare login form, which is what
// "reset password isn't working" looked like from the customer's side:
//
//   ?code=<uuid>                        PKCE (what @supabase/ssr requests)
//   #access_token=…&refresh_token=…     implicit / older templates
//   ?token_hash=…&type=recovery         {{ .TokenHash }} templates
//
// This page accepts all three, and when it can't establish a session it says
// why instead of failing silently.

type Status = 'verifying' | 'ready' | 'failed'

export default function ResetPasswordPage() {
  const router = useRouter()

  const [status, setStatus] = useState<Status>('verifying')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // React 18 StrictMode double-invokes effects in dev; the recovery grant is
  // single-use, so a second exchange would fail against an already-spent code.
  const claimed = useRef(false)

  const establishSession = useCallback(async () => {
    const supabase = getAuthClient()
    const url = new URL(window.location.href)
    const query = url.searchParams
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''))

    // GoTrue reports a dead link (expired, already used, consumed by an email
    // scanner) as an error param rather than by omitting the grant.
    const gotrueError = query.get('error_description') ?? hash.get('error_description')
    if (gotrueError) return gotrueError

    const code = query.get('code')
    const tokenHash = query.get('token_hash')
    const accessToken = hash.get('access_token')
    const refreshToken = hash.get('refresh_token')

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) return null
      // PKCE keeps the code verifier in browser storage on the device that
      // asked for the reset, so a link opened on a phone after requesting it
      // on a desktop can't complete. Say that plainly.
      if (/verifier/i.test(error.message)) {
        return 'This reset link was opened on a different device or browser than the one it was requested from. Request a new link and open it on this device.'
      }
      return error.message
    }

    if (tokenHash) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      return error ? error.message : null
    }

    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      return error ? error.message : null
    }

    // No grant in the URL — but the customer may already be signed in and
    // have navigated here directly, which is a perfectly good way to change a
    // password.
    const { data } = await supabase.auth.getSession()
    if (data.session) return null

    return 'This password reset link is missing its verification token. It may have been truncated by your email client — request a new one.'
  }, [])

  useEffect(() => {
    if (claimed.current) return
    claimed.current = true

    // Deliberately no `active`/cleanup guard here. The ref above already
    // guarantees this runs exactly once, and under StrictMode a cleanup flag
    // would be flipped false by the simulated unmount before the exchange
    // resolves — while the ref stops the re-run from ever re-arming it. The
    // result would then be dropped and the page would sit on "Checking your
    // reset link…" forever in dev.
    establishSession().then((error) => {
      if (error) {
        setLinkError(error)
        setStatus('failed')
        return
      }
      // Drop the grant from the address bar so it isn't left in history or
      // leaked via a referer header.
      window.history.replaceState(null, '', '/reset-password')
      setStatus('ready')
    })
  }, [establishSession])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)

    if (password.length < 8) {
      setSaveError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setSaveError('Passwords do not match.')
      return
    }

    setSaving(true)
    const supabase = getAuthClient()
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)

    if (error) {
      setSaveError(error.message)
      return
    }

    setDone(true)
    setTimeout(() => router.push('/account'), 1500)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-sm w-full">
        <div className="flex h-10 w-10 flex-col items-center justify-center border-2 border-gray-900 leading-none mx-auto mb-6">
          <span
            className="font-black tracking-tighter text-gray-900"
            style={{ fontSize: '10px', letterSpacing: '-0.5px' }}
          >
            L &amp; Y
          </span>
          <span className="font-bold text-gray-900" style={{ fontSize: '9px' }}>
            USA
          </span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Choose a new password</h1>
        <p className="text-sm text-gray-500 text-center mb-8">
          You&apos;ll be signed in once it&apos;s saved
        </p>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {status === 'verifying' && (
            <p className="text-sm text-gray-500 text-center">Checking your reset link…</p>
          )}

          {status === 'failed' && (
            <div className="space-y-4">
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {linkError}
              </p>
              <Link
                href="/login"
                className="block w-full rounded-lg bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-red-700 transition-colors"
              >
                Request a new link
              </Link>
            </div>
          )}

          {status === 'ready' &&
            (done ? (
              <p className="text-sm text-green-700 text-center">
                Password updated. Taking you to your account…
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="new-password"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    New password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                    placeholder="At least 8 characters"
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirm-password"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Confirm password
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                    placeholder="Repeat new password"
                  />
                </div>

                {saveError && <p className="text-red-600 text-sm">{saveError}</p>}

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Saving…' : 'Save new password'}
                </button>
              </form>
            ))}
        </div>

        <p className="text-sm text-center mt-6 text-gray-500">
          <Link href="/login" className="font-medium text-red-600 hover:text-red-700">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
