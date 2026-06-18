import { Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import ProductGrid from '@/components/catalog/ProductGrid'
import CategoryNav from '@/components/catalog/CategoryNav'
import Pagination from '@/components/catalog/Pagination'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 48

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; category?: string; page?: string }>
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const { q, category, page: pageParam } = await searchParams
  const page = Math.max(1, parseInt(pageParam ?? '1'))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data: categories } = await supabase
    .from('categories')
    .select('*')
    .order('display_order')

  let query = supabase
    .from('products')
    .select('*, category:categories(*)', { count: 'exact' })
    .eq('is_active', true)
    .eq('manually_hidden', false)

  if (category && categories) {
    const cat = categories.find((c) => c.slug === category)
    if (cat) query = query.eq('category_id', cat.id)
  }

  if (q?.trim()) {
    const term = q.trim()
    query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%,sku.ilike.%${term}%`)
  }

  const { data: products, count } = await query.order('name').range(from, to)
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="lg:w-48 lg:shrink-0">
        <div className="lg:sticky lg:top-24">
          <p className="mb-3 hidden text-xs font-semibold uppercase tracking-wider text-gray-500 lg:block">
            Categories
          </p>
          <Suspense fallback={null}>
            <CategoryNav categories={categories ?? []} activeSlug={category} />
          </Suspense>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {(count ?? 0).toLocaleString()} {(count ?? 0) === 1 ? 'product' : 'products'}
            {q && (
              <span>
                {' '}for &ldquo;<span className="font-medium text-gray-900">{q}</span>&rdquo;
              </span>
            )}
          </p>
        </div>
        <ProductGrid products={products ?? []} />
        {totalPages > 1 && <Pagination page={page} totalPages={totalPages} />}
      </div>
    </div>
  )
}
