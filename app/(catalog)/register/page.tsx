'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getAuthClient } from '@/lib/auth-client'

export default function RegisterPage() {
  const router = useRouter()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [company, setCompany] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      setLoading(false)
      return
    }

    const supabase = getAuthClient()
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, company },
      },
    })

    if (signUpError) {
      if (
        signUpError.message.toLowerCase().includes('already registered') ||
        signUpError.message.toLowerCase().includes('already exists') ||
        signUpError.message.toLowerCase().includes('user already')
      ) {
        setError('An account with this email already exists. Sign in instead.')
      } else {
        setError(signUpError.message)
      }
      setLoading(false)
      return
    }

    // If session is returned, email confirmation is disabled — go straight to account
    if (data.session) {
      router.push('/account')
      return
    }

    setLoading(false)
    setConfirmed(true)
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
          Create your account
        </h1>
        <p className="text-sm text-gray-500 text-center mb-8">
          Get instant access to your order history
        </p>

        {/* Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {confirmed ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-gray-700">
                Account created! Check your email to confirm, then{' '}
                <Link href="/login" className="font-medium text-red-600 hover:text-red-700">
                  sign in
                </Link>
                .
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Full name
                </label>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  placeholder="Jane Smith"
                />
              </div>

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
                  <span className="ml-1 text-xs text-gray-400">(min 8 characters)</span>
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-1">
                  Company
                  <span className="ml-1 text-xs text-gray-400">(optional)</span>
                </label>
                <input
                  id="company"
                  type="text"
                  autoComplete="organization"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  placeholder="Acme Wholesale"
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
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          )}
        </div>

        {/* Login link */}
        <p className="text-sm text-center mt-6 text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-red-600 hover:text-red-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
