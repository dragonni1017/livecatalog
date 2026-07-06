'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { getAuthClient } from '@/lib/auth-client'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') ?? '/account'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = getAuthClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    router.push(from)
  }

  async function handleForgotPassword() {
    if (!email) {
      setError('Enter your email address above, then click "Forgot your password?"')
      return
    }
    setResetLoading(true)
    setError(null)

    const supabase = getAuthClient()
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/api/auth/callback?next=/account/settings',
    })

    setResetLoading(false)
    setResetSent(true)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-sm w-full">
        {/* Logo */}
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

        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
          Sign in to your account
        </h1>
        <p className="text-sm text-gray-500 text-center mb-8">
          View your orders and account details
        </p>

        {/* Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {resetSent ? (
            <p className="text-sm text-gray-700 text-center">
              Check your email for a password reset link.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <p className="text-red-600 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {/* Forgot password */}
          {!resetSent && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={resetLoading}
                className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-60 transition-colors"
              >
                {resetLoading ? 'Sending…' : 'Forgot your password?'}
              </button>
            </div>
          )}
        </div>

        {/* Register link */}
        <p className="text-sm text-center mt-6 text-gray-500">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="font-medium text-red-600 hover:text-red-700">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading…</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
