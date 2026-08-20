'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [require2fa, setRequire2fa] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const totpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (require2fa) {
      totpRef.current?.focus()
    }
  }, [require2fa])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/rep/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, totp: require2fa ? totp : '' }),
      })

      if (res.ok) {
        router.push('/rep')
        router.refresh()
        return
      }

      const data = await res.json()

      if (data.require2fa) {
        setRequire2fa(true)
        setTotp('')
        setError('')
      } else if (res.status === 401 && require2fa) {
        setError('Invalid authenticator code. Please try again.')
        setTotp('')
      } else {
        setError('Incorrect password. Please try again.')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">L &amp; Y USA</h1>
          <p className="text-sm text-gray-500 mt-1">Rep Portal</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!require2fa ? (
            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  placeholder="rep@example.com"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  placeholder="Password"
                />
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="totp" className="block text-sm font-medium text-gray-700 mb-1">
                Enter your 6-digit authenticator code
              </label>
              <input
                ref={totpRef}
                id="totp"
                name="totp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                required
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 tracking-widest text-center text-lg"
                placeholder="000000"
              />
              <button
                type="button"
                onClick={() => { setRequire2fa(false); setTotp(''); setError('') }}
                className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                &larr; Back to password
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Verifying…' : require2fa ? 'Verify Code' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function RepLoginPage() {
  return <LoginForm />
}
