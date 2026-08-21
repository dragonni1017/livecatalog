'use client'

// Plain <a href="/api/rep/auth?action=logout"> already forces a real
// browser navigation (not a Next.js Link, so nothing intercepts it), but an
// explicit JS-driven hard reload here removes any doubt and survives a
// future refactor that might accidentally wrap it in a Link. Awaiting the
// logout request before navigating also guarantees the tier cookie (now
// cleared server-side in that response) is gone before this browser shows
// anything else.
export default function SignOutButton() {
  async function handleSignOut() {
    try {
      await fetch('/api/rep/auth?action=logout', { cache: 'no-store' })
    } finally {
      window.location.href = '/rep/login'
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="text-sm text-gray-500 hover:text-gray-700 underline"
    >
      Sign out
    </button>
  )
}
