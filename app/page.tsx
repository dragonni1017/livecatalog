import { Suspense } from 'react'
import Link from 'next/link'
import { MOCK_CATEGORIES, MOCK_PRODUCTS_WITH_CATEGORY } from '@/lib/mock-data'
import ProductGrid from '@/components/catalog/ProductGrid'
import CategoryNav from '@/components/catalog/CategoryNav'
import SearchInput from '@/components/catalog/SearchInput'

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; category?: string }>
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const { q, category } = await searchParams

  let products = MOCK_PRODUCTS_WITH_CATEGORY.filter((p) => p.is_active)

  if (category) {
    products = products.filter((p) => p.category?.slug === category)
  }

  if (q) {
    const query = q.toLowerCase()
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.description ?? '').toLowerCase().includes(query)
    )
  }

  const activeCategory = category ?? undefined

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky nav */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">

          {/* L&Y USA Logo */}
          <Link href="/" className="shrink-0 group">
            <div className="flex h-10 w-10 flex-col items-center justify-center border-2 border-gray-900 leading-none group-hover:border-red-600 transition-colors">
              <span className="text-xs font-black tracking-tighter text-gray-900 group-hover:text-red-600 transition-colors" style={{fontSize: '10px', letterSpacing: '-0.5px'}}>L &amp; Y</span>
              <span className="text-xs font-bold text-gray-900 group-hover:text-red-600 transition-colors" style={{fontSize: '9px'}}>USA</span>
            </div>
          </Link>

          {/* Brand name */}
          <Link href="/" className="shrink-0 hidden sm:block">
            <span className="text-base font-bold tracking-wide text-gray-900 hover:text-red-600 transition-colors">
              L &amp; Y USA
            </span>
            <span className="ml-2 text-xs text-gray-400 font-medium uppercase tracking-widest">Product Catalog 2026</span>
          </Link>

          {/* Search */}
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

          {/* Contact info */}
          <div className="shrink-0 hidden lg:block text-right">
            <p className="text-xs font-medium text-gray-900">626-552-4120</p>
            <p className="text-xs text-gray-400">www.ly-usa.com</p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <aside className="lg:w-48 lg:shrink-0">
            <div className="lg:sticky lg:top-[62px] lg:h-[calc(100vh-62px)] lg:overflow-y-auto lg:pb-8">
              <p className="mb-3 hidden pt-2 text-xs font-semibold uppercase tracking-wider text-gray-500 lg:block">
                Categories
              </p>
              <Suspense fallback={null}>
                <CategoryNav categories={MOCK_CATEGORIES} activeSlug={activeCategory} />
              </Suspense>
            </div>
          </aside>

          <div className="flex-1 min-w-0">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {products.length} {products.length === 1 ? 'product' : 'products'}
                {q && (
                  <span>
                    {' '}for &ldquo;<span className="font-medium text-gray-900">{q}</span>&rdquo;
                  </span>
                )}
              </p>
            </div>
            <ProductGrid products={products} />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 flex-col items-center justify-center border-2 border-gray-900">
                <span className="font-black text-gray-900" style={{fontSize: '8px', letterSpacing: '-0.5px'}}>L &amp; Y</span>
                <span className="font-bold text-gray-900" style={{fontSize: '7px'}}>USA</span>
              </div>
              <span className="text-sm font-bold text-gray-900">L &amp; Y USA</span>
            </div>
            <div className="flex flex-col gap-1 text-xs text-gray-500 sm:text-right">
              <p><span className="font-medium text-gray-700">Warehouse:</span> 3183 Bandini Blvd, Vernon, CA 90058</p>
              <p><span className="font-medium text-gray-700">Store:</span> 310 South Los Angeles St., Los Angeles, CA 90013</p>
            </div>
            <div className="text-xs text-gray-500">
              <p className="font-medium text-gray-700">626-552-4120</p>
              <p>www.ly-usa.com</p>
            </div>
          </div>
        </div>
        {/* Red accent bar at bottom */}
        <div className="h-1.5 bg-red-600" />
      </footer>
    </div>
  )
}
