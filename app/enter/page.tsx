import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Enter Access Code',
  robots: { index: false },
}

interface EnterPageProps {
  searchParams: Promise<{ error?: string; from?: string }>
}

// Catalog access gate. Shown only when CATALOG_ACCESS_CODE is set and the
// visitor doesn't yet have the access cookie (see middleware.ts).
export default async function EnterPage({ searchParams }: EnterPageProps) {
  const { error, from } = await searchParams

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">L &amp; Y USA</h1>
          <p className="mt-1 text-sm text-gray-500">Wholesale Catalog</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Incorrect code. Please try again.
          </div>
        )}

        <form method="POST" action="/api/catalog-access" className="space-y-4">
          <input type="hidden" name="from" value={from ?? '/'} />
          <div>
            <label htmlFor="code" className="mb-1 block text-sm font-medium text-gray-700">
              Access code
            </label>
            <input
              id="code"
              name="code"
              type="password"
              required
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              placeholder="Enter your access code"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Enter catalog
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          Need access? Contact your L &amp; Y USA rep.
        </p>
      </div>
    </div>
  )
}
