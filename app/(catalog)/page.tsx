import { Suspense } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import ProductGrid from '@/components/catalog/ProductGrid'
import CategoryNav from '@/components/catalog/CategoryNav'
import CatalogControls from '@/components/catalog/CatalogControls'
import { Category, Product } from '@/lib/types'

export const dynamic = 'force-dynamic'

const PER_PAGE_OPTIONS = [20, 50, 100]
const DEFAULT_PER_PAGE = 20

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; category?: string; page?: string; sort?: string; instock?: string; per?: string; minPrice?: string; maxPrice?: string }>
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const {
    q,
    category,
    page: pageParam,
    sort: sortParam,
    instock,
    per: perParam,
    minPrice: minPriceRaw,
    maxPrice: maxPriceRaw,
  } = await searchParams

  // Reject non-numeric price params outright rather than letting them fall
  // through to a silently-skipped filter that still gets echoed verbatim in
  // the "Price: $x – $y" label below (e.g. ?maxPrice=abc rendering as "$abc").
  const minPrice = minPriceRaw !== undefined && Number.isFinite(parseFloat(minPriceRaw)) ? minPriceRaw : undefined
  const maxPrice = maxPriceRaw !== undefined && Number.isFinite(parseFloat(maxPriceRaw)) ? maxPriceRaw : undefined

  const sort = sortParam ?? 'sku'
  const inStock = instock === '1'
  const minCents = minPrice ? Math.round(parseFloat(minPrice) * 100) : null
  const maxCents = maxPrice ? Math.round(parseFloat(maxPrice) * 100) : null
  const perRaw = parseInt(perParam ?? '', 10)
  const pageSize = PER_PAGE_OPTIONS.includes(perRaw) ? perRaw : DEFAULT_PER_PAGE
  const currentPage = Math.max(1, parseInt(pageParam ?? '1') || 1)
  const pageStart = (currentPage - 1) * pageSize

  const { data: categoriesData } = await supabase.from('categories').select('*').order('name')
  const categories = (categoriesData ?? []) as Category[]

  // Build product query
  let query = supabase
    .from('products')
    .select('*, category:categories!products_category_id_fkey(*)', { count: 'exact' })
    .eq('is_active', true)
    .eq('manually_hidden', false)

  const categoryMatch = category ? categories.find(c => c.slug === category) : undefined
  const categoryNotFound = !!category && !categoryMatch
  if (categoryMatch) {
    // A product can now belong to more than one category (product_categories
    // join table) -- match any product carrying this category, not just
    // whichever one happens to be its "primary" categories.category_id.
    const { data: memberRows } = await supabase
      .from('product_categories')
      .select('product_id')
      .eq('category_id', categoryMatch.id)
    const memberIds = (memberRows ?? []).map((r) => r.product_id)
    query = query.in('id', memberIds.length > 0 ? memberIds : ['__none__'])
  }

  if (inStock) query = query.gt('stock_qty', 0)

  if (minCents) query = query.gte('price_cents', minCents)
  if (maxCents) query = query.lte('price_cents', maxCents)

  // Multi-word search: each word must appear in name, description, SKU, or
  // barcode, so "blue widget" matches "Widget, Blue" regardless of word
  // order, and scanning/typing a barcode finds the product directly. Strip
  // chars that would break PostgREST's filter syntax.
  if (q?.trim()) {
    for (const word of q.trim().split(/\s+/)) {
      const w = word.replace(/[%,()]/g, '')
      if (w) query = query.or(`name.ilike.%${w}%,description.ilike.%${w}%,sku.ilike.%${w}%,barcode.ilike.%${w}%`)
    }
  }

  // Sorting
  switch (sort) {
    case 'price_asc':
      query = query.order('price_cents', { ascending: true })
      break
    case 'price_desc':
      query = query.order('price_cents', { ascending: false })
      break
    case 'newest':
      query = query.order('created_at', { ascending: false })
      break
    case 'name':
      query = query.order('name', { ascending: true })
      break
    default:
      query = query.order('sku', { ascending: true })
  }

  const { data: productsData, count } = await query.range(pageStart, pageStart + pageSize - 1)
  const pagedProducts = (productsData ?? []) as Product[]
  const totalProducts = count ?? 0
  const totalPages = Math.ceil(totalProducts / pageSize)

  // Build URL helper preserving existing params
  function pageUrl(p: number) {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (category) params.set('category', category)
    if (sort !== 'sku') params.set('sort', sort)
    if (inStock) params.set('instock', '1')
    if (pageSize !== DEFAULT_PER_PAGE) params.set('per', String(pageSize))
    if (minPrice) params.set('minPrice', minPrice)
    if (maxPrice) params.set('maxPrice', maxPrice)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return qs ? `/?${qs}` : '/'
  }

  // Build clear-price URL (preserve all other params, drop minPrice/maxPrice)
  const clearPriceUrl = (() => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (category) params.set('category', category)
    if (sort !== 'sku') params.set('sort', sort)
    if (inStock) params.set('instock', '1')
    if (pageSize !== DEFAULT_PER_PAGE) params.set('per', String(pageSize))
    const qs = params.toString()
    return qs ? `/?${qs}` : '/'
  })()

  const activeCategory = categoryMatch?.slug

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="lg:w-48 lg:shrink-0">
        <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-8">
          <p className="mb-3 hidden pt-2 text-xs font-semibold uppercase tracking-wider text-gray-500 lg:block">
            Categories
          </p>
          <Suspense fallback={
            <>
              {/* Mobile: pill strip skeleton */}
              <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
                {[56, 44, 80, 72, 64, 60, 76].map((w, i) => (
                  <div key={i} className="h-8 shrink-0 rounded-full bg-gray-200 animate-pulse" style={{ width: `${w}px` }} />
                ))}
              </div>
              {/* Desktop: sidebar list skeleton */}
              <div className="hidden lg:flex lg:flex-col lg:gap-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-9 w-full rounded-md bg-gray-100 animate-pulse" />
                ))}
              </div>
            </>
          }>
            <CategoryNav categories={categories} activeSlug={activeCategory} />
          </Suspense>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Price range filter form */}
        <form method="get" className="mb-3 flex flex-wrap items-center gap-3">
          {q && <input type="hidden" name="q" value={q} />}
          {category && <input type="hidden" name="category" value={category} />}
          {sort !== 'sku' && <input type="hidden" name="sort" value={sort} />}
          {inStock && <input type="hidden" name="instock" value="1" />}
          {pageSize !== DEFAULT_PER_PAGE && <input type="hidden" name="per" value={String(pageSize)} />}
          <span className="text-sm text-gray-500 font-medium">Price</span>
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input
                type="number"
                name="minPrice"
                defaultValue={minPrice ?? ''}
                placeholder="Min"
                min="0"
                step="0.01"
                className="w-24 pl-6 pr-2 py-1.5 rounded-lg border border-gray-300 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
            <span className="text-gray-400 text-sm">–</span>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <input
                type="number"
                name="maxPrice"
                defaultValue={maxPrice ?? ''}
                placeholder="Max"
                min="0"
                step="0.01"
                className="w-24 pl-6 pr-2 py-1.5 rounded-lg border border-gray-300 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Apply
            </button>
          </div>
        </form>

        {/* Active price filter chip */}
        {(minPrice || maxPrice) && (
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-gray-500">
              Price: {minPrice ? `$${minPrice}` : 'any'} – {maxPrice ? `$${maxPrice}` : 'any'}
            </span>
            <Link href={clearPriceUrl} className="text-red-600 hover:text-red-700 text-xs underline">
              Clear price filter
            </Link>
          </div>
        )}

        {categoryNotFound && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            We couldn&apos;t find that category — showing all products instead.
          </p>
        )}

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500">
            {totalProducts} {totalProducts === 1 ? 'product' : 'products'}
            {q && (
              <span>
                {' '}for &ldquo;<span className="font-medium text-gray-900">{q}</span>&rdquo;
              </span>
            )}
            {totalPages > 1 && (
              <span className="ml-2 text-gray-400">
                · page {currentPage} of {totalPages}
              </span>
            )}
          </p>
          <Suspense fallback={
            <div className="flex items-center gap-3">
              <div className="h-4 w-24 rounded bg-gray-200 animate-pulse" />
              <div className="h-8 w-36 rounded-md bg-gray-200 animate-pulse" />
              <div className="h-8 w-28 rounded-md bg-gray-200 animate-pulse" />
            </div>
          }>
            <CatalogControls sort={sort} inStock={inStock} perPage={pageSize} />
          </Suspense>
        </div>

        <ProductGrid products={pagedProducts} />

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-2">
            {/* Prev */}
            {currentPage > 1 ? (
              <Link
                href={pageUrl(currentPage - 1)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                ← Prev
              </Link>
            ) : (
              <span className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-300 cursor-not-allowed">
                ← Prev
              </span>
            )}

            {/* Page numbers */}
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis')
                  acc.push(p)
                  return acc
                }, [])
                .map((item, idx) =>
                  item === 'ellipsis' ? (
                    <span key={`ellipsis-${idx}`} className="px-1 text-gray-400">…</span>
                  ) : (
                    <Link
                      key={item}
                      href={pageUrl(item as number)}
                      className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        item === currentPage
                          ? 'bg-red-600 text-white'
                          : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {item}
                    </Link>
                  )
                )}
            </div>

            {/* Next */}
            {currentPage < totalPages ? (
              <Link
                href={pageUrl(currentPage + 1)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Next →
              </Link>
            ) : (
              <span className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-300 cursor-not-allowed">
                Next →
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
