import { Suspense } from 'react'
import Link from 'next/link'
import SearchInput from '@/components/catalog/SearchInput'
import CartIndicator from '@/components/catalog/CartIndicator'
import FavoritesLink from '@/components/catalog/FavoritesLink'
import AccountNav from '@/components/catalog/AccountNav'
import Footer from '@/components/catalog/Footer'
import { FavoritesProvider } from '@/lib/favorites-context'

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <FavoritesProvider>
    <div className="min-h-screen bg-gray-50">
      {/* Sticky top nav */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 lg:px-8">
          {/* L&Y USA logo */}
          <Link href="/" className="group shrink-0">
            <div className="flex h-10 w-10 flex-col items-center justify-center border-2 border-gray-900 leading-none transition-colors group-hover:border-red-600">
              <span
                className="font-black tracking-tighter text-gray-900 transition-colors group-hover:text-red-600"
                style={{ fontSize: '10px', letterSpacing: '-0.5px' }}
              >
                L &amp; Y
              </span>
              <span
                className="font-bold text-gray-900 transition-colors group-hover:text-red-600"
                style={{ fontSize: '9px' }}
              >
                USA
              </span>
            </div>
          </Link>

          {/* Brand name */}
          <Link href="/" className="hidden shrink-0 sm:block">
            <span className="text-base font-bold tracking-wide text-gray-900 transition-colors hover:text-red-600">
              L &amp; Y USA
            </span>
            <span className="ml-2 text-xs font-medium uppercase tracking-widest text-gray-400">
              Product Catalog 2026
            </span>
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

          {/* Right side: contact + saved + quick order + cart */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <div className="hidden text-right lg:block">
              <p className="text-xs font-medium text-gray-900">626-552-4120</p>
              <p className="text-xs text-gray-400">www.ly-usa.com</p>
            </div>
            <FavoritesLink />
            <Link
              href="/quick-order"
              className="hidden text-xs font-medium text-gray-600 hover:text-red-600 sm:block"
            >
              Quick&nbsp;Order
            </Link>
            <AccountNav />
            <CartIndicator />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>

      <Footer />
    </div>
    </FavoritesProvider>
  )
}
