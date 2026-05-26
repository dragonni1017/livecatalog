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
          <Link
            href="/"
            className="shrink-0 text-lg font-bold tracking-tight text-indigo-600 hover:text-indigo-700"
          >
            LiveCatalog
          </Link>
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
          <div className="shrink-0 w-32" />
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <aside className="lg:w-48 lg:shrink-0">
            <div className="lg:sticky lg:top-24">
              <p className="mb-3 hidden text-xs font-semibold uppercase tracking-wider text-gray-500 lg:block">
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
    </div>
  )
}
