import { Suspense } from 'react'
import { MOCK_CATEGORIES, MOCK_PRODUCTS_WITH_CATEGORY } from '@/lib/mock-data'
import ProductGrid from '@/components/catalog/ProductGrid'
import CategoryNav from '@/components/catalog/CategoryNav'

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; category?: string }>
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const { q, category } = await searchParams

  // Filter products
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
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      {/* Sidebar / category nav */}
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

      {/* Product grid */}
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
  )
}
