'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAuthClient } from '@/lib/auth-client'

export default function AccountSettingsPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)

  // Profile form state
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)
  const [profileError, setProfileError] = useState('')

  // Password form state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    const supabase = getAuthClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login?from=/account/settings')
        return
      }
      setName(session.user.user_metadata?.name ?? '')
      setCompany(session.user.user_metadata?.company ?? '')
      setAuthChecked(true)
    })
  }, [router])

  if (!authChecked) return null

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault()
    setProfileLoading(true)
    setProfileSuccess(false)
    setProfileError('')
    const supabase = getAuthClient()
    const { error } = await supabase.auth.updateUser({ data: { name, company } })
    setProfileLoading(false)
    if (error) {
      setProfileError(error.message)
    } else {
      setProfileSuccess(true)
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess(false)

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }

    setPasswordLoading(true)
    const supabase = getAuthClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPasswordLoading(false)
    if (error) {
      setPasswordError(error.message)
    } else {
      setPasswordSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Back link */}
      <Link
        href="/account"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
          />
        </svg>
        Back to account
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-gray-900">Account Settings</h1>

      {/* Profile section */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Profile
        </h2>
        <form onSubmit={handleProfileSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Your name"
            />
          </div>
          <div>
            <label
              htmlFor="company"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Company
            </label>
            <input
              id="company"
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Your company (optional)"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={profileLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {profileLoading ? 'Saving…' : 'Save profile'}
            </button>
            {profileSuccess && (
              <span className="text-sm text-green-600">Profile updated!</span>
            )}
            {profileError && (
              <span className="text-sm text-red-600">{profileError}</span>
            )}
          </div>
        </form>
      </div>

      {/* Password section */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Change Password
        </h2>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="newPassword"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Repeat new password"
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={passwordLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {passwordLoading ? 'Updating…' : 'Update password'}
            </button>
            {passwordSuccess && (
              <span className="text-sm text-green-600">Password updated!</span>
            )}
            {passwordError && (
              <span className="text-sm text-red-600">{passwordError}</span>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
