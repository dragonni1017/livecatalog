import { Suspense } from 'react'
import Link from 'next/link'
import SearchInput from '@/components/catalog/SearchInput'

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky top nav */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
          {/* Site name */}
          <Link
            href="/"
            className="shrink-0 text-lg font-bold tracking-tight text-red-600 hover:text-red-700"
          >
            LiveCatalog
          </Link>

          {/* Center: search */}
          <div className="flex flex-1 justify-center">
            <Suspense fallback={
              <div className="w-full max-w-sm">
                <input
                  type="search"
                  disabled
                  placeholder="Search products..."
                  className="block w-full rounded-md border border-gray-300 bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-400"
                />
              </div>
            }>
              <SearchInput />
            </Suspense>
          </div>

          {/* Right side: empty for now */}
          <div className="shrink-0 w-32" />
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
