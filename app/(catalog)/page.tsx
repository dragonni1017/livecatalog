import { Suspense } from 'react'
import Link from 'next/link'
import { getAdminClient, supabase } from '@/lib/supabase'
import { loadCollectionStrip, loadLiveCollections } from '@/lib/collections'
import CollectionStrip from '@/components/catalog/CollectionStrip'
import ProductGrid from '@/components/catalog/ProductGrid'
import CategoryNav from '@/components/catalog/CategoryNav'
import { loadCategoryCounts } from '@/lib/category-counts'
import { departmentBySlug, departmentSlug, groupCategories } from '@/lib/category-groups'
import { loadDepartmentPhotos } from '@/lib/department-tiles'
import DepartmentTiles from '@/components/catalog/DepartmentTiles'
import RecentlyViewed from '@/components/catalog/RecentlyViewed'
import { catalogHref, filterChips, type CatalogState } from '@/lib/catalog-url'
import CatalogControls from '@/components/catalog/CatalogControls'
import { Category, Product } from '@/lib/types'
import { parseCaseSize, parseSoldBy } from '@/lib/catalog-filters'
import { resolveCategorySlug } from '@/lib/category-slugs'
import { permanentRedirect } from 'next/navigation'
import { searchWords, suggestSearch, wordOrFilter } from '@/lib/search-terms'
import { loadSearchVocabulary } from '@/lib/search-vocab'

export const dynamic = 'force-dynamic'

const PER_PAGE_OPTIONS = [20, 50, 100]
const DEFAULT_PER_PAGE = 20
const SEARCH_FIELDS = ['name', 'description', 'sku', 'barcode'] as const

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; category?: string; dept?: string; page?: string; sort?: string; instock?: string; per?: string; minPrice?: string; maxPrice?: string; soldby?: string; case?: string }>
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const {
    q,
    category,
    dept: deptParam,
    page: pageParam,
    sort: sortParam,
    instock,
    per: perParam,
    minPrice: minPriceRaw,
    maxPrice: maxPriceRaw,
    soldby: soldByRaw,
    case: caseRaw,
  } = await searchParams

  // Unknown values are ignored rather than echoed (same reasoning as price).
  const soldBy = parseSoldBy(soldByRaw)
  const caseSize = parseCaseSize(caseRaw)

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

  // The collection strip only shows on the plain landing view: no search,
  // category, filter, sort or later page, so it doesn't crowd browsing.
  const isLandingView =
    !q && !category && !deptParam && !sortParam && !instock && !minPrice && !maxPrice && !soldBy && !caseSize && currentPage === 1
  const [{ data: categoriesData }, collections, stripCards] = await Promise.all([
    supabase.from('categories').select('*').order('name'),
    loadLiveCollections(getAdminClient()),
    isLandingView ? loadCollectionStrip(getAdminClient()) : Promise.resolve([]),
  ])
  const categories = (categoriesData ?? []) as Category[]
  // Products per category/department for the grouped menu (cached 10 min).
  const categoryCounts = await loadCategoryCounts(categories)
  // Department tiles on the plain landing view only, like the collection strip.
  const departmentPhotosMap = isLandingView ? await loadDepartmentPhotos(categories) : null

  // Build product query
  let query = supabase
    .from('products')
    .select('*, category:categories!products_category_id_fkey(*)', { count: 'exact' })
    .eq('is_active', true)
    .eq('manually_hidden', false)

  // An old link to a renamed category (?category=christmas) moves to its
  // current slug, keeping every other filter on the URL.
  if (category) {
    const current = resolveCategorySlug(category, categories.map((c) => c.slug))
    if (current !== category) {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') params.set(k, v)
      params.set('category', current)
      permanentRedirect(`/?${params.toString()}`)
    }
  }

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

  // A whole department (?dept=, lib/category-groups.ts), when no single
  // category is picked. Filtered on the primary category_id: for every
  // department that matches the product_categories membership count exactly
  // (checked 2026-11-06), and it keeps the request short, where a product-id
  // list for Florals & Gifts would pass 1,000 ids.
  const department = categoryMatch ? null : departmentBySlug(deptParam)
  if (department) {
    const deptIds = categories.filter((c) => department.categories.includes(c.name)).map((c) => c.id)
    query = query.in('category_id', deptIds.length > 0 ? deptIds : ['__none__'])
  }

  if (inStock) query = query.gt('stock_qty', 0)

  if (minCents) query = query.gte('price_cents', minCents)
  if (maxCents) query = query.lte('price_cents', maxCents)

  // Generated columns from the name's pack spec (migration 0054). A product
  // with no pack spec has NULLs and drops out of these filters only.
  if (soldBy) query = query.eq('sold_by', soldBy)
  if (caseSize?.min != null) query = query.gte('case_pieces', caseSize.min)
  if (caseSize?.max != null) query = query.lte('case_pieces', caseSize.max)

  // Multi-word search: each word must appear in name, description, SKU, or
  // barcode, so "blue widget" matches "Widget, Blue" regardless of word
  // order, and scanning/typing a barcode finds the product directly. Each
  // word also matches its singular/plural ("speakers" finds "Speaker"),
  // its synonyms ("journal" finds notebooks) and category names
  // ("stationery" finds the Stationery & Office category); lib/search-terms.ts.
  for (const word of searchWords(q)) {
    query = query.or(wordOrFilter(word, SEARCH_FIELDS, categories))
  }

  // Sorting. Out-of-stock products go last in every sort (28% of product
  // views landed on them, 2026-11-09): products.in_stock is generated from
  // stock_qty (migration 0076), since PostgREST can't order by an expression.
  query = query.order('in_stock', { ascending: false })
  switch (sort) {
    case 'price_asc':
      query = query.order('price_cents', { ascending: true })
      break
    case 'price_desc':
      query = query.order('price_cents', { ascending: false })
      break
    case 'newest':
      // Most recently received first (arrived_at, set from /admin/receiving;
      // migration 0055). Products with no recorded arrival follow, in import
      // order: created_at is only the date a row reached Supabase.
      query = query
        .order('arrived_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
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

  // Every catalog link keeps the same filters (lib/catalog-url.ts).
  const urlState: CatalogState = {
    q,
    category: categoryMatch?.slug,
    dept: department ? departmentSlug(department.name) : undefined,
    sort,
    inStock,
    soldBy: soldBy ?? undefined,
    caseSize: caseSize?.value,
    per: pageSize,
    minPrice,
    maxPrice,
  }
  function pageUrl(p: number) {
    return catalogHref({ ...urlState, page: p })
  }

  // "Did you mean": a misspelled search ("swuishy") gets the closest words
  // from product names, offered only if that search finds something. Must
  // stay below urlState: pageUrl() reads it, and calling it earlier threw
  // a ReferenceError (500) on every correctable typo (2026-11-06 to -11).
  let didYouMean: { q: string; href: string } | null = null
  if (totalProducts === 0 && q?.trim()) {
    const vocab = await loadSearchVocabulary()
    const fixed = vocab ? suggestSearch(q, vocab) : null
    if (fixed) {
      let check = supabase.from('products').select('id').eq('is_active', true).eq('manually_hidden', false)
      for (const word of searchWords(fixed)) check = check.or(wordOrFilter(word, SEARCH_FIELDS, categories))
      const { data: hit } = await check.limit(1)
      if (hit?.length) {
        // Same filters as now, first page, corrected words.
        const params = new URLSearchParams(pageUrl(1).split('?')[1] ?? '')
        params.set('q', fixed)
        didYouMean = { q: fixed, href: `/?${params.toString()}` }
      }
    }
  }
  const chips = filterChips(urlState, { category: categoryMatch?.name, dept: department?.name })

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
            <CategoryNav categories={categories} activeSlug={activeCategory} activeDept={department ? departmentSlug(department.name) : undefined} collections={collections} counts={categoryCounts} />
          </Suspense>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {isLandingView && <DepartmentTiles departments={groupCategories(categories, categoryCounts)} photos={departmentPhotosMap} />}
        <CollectionStrip cards={stripCards} />
        {isLandingView && <RecentlyViewed />}

        {/* Price range filter form */}
        <form method="get" className="mb-3 flex flex-wrap items-center gap-3">
          {q && <input type="hidden" name="q" value={q} />}
          {category && <input type="hidden" name="category" value={category} />}
          {department && !category && <input type="hidden" name="dept" value={departmentSlug(department.name)} />}
          {sort !== 'sku' && <input type="hidden" name="sort" value={sort} />}
          {inStock && <input type="hidden" name="instock" value="1" />}
          {soldBy && <input type="hidden" name="soldby" value={soldBy} />}
          {caseSize && <input type="hidden" name="case" value={caseSize.value} />}
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

        {/* What's applied, each removable in one click */}
        {chips.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            {chips.map((chip) => (
              <Link
                key={chip.label}
                href={chip.href}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700 hover:border-red-400"
                aria-label={`Remove ${chip.label}`}
              >
                {chip.label}
                <span aria-hidden="true" className="text-red-400">✕</span>
              </Link>
            ))}
            {chips.length > 1 && (
              <Link href={catalogHref({ sort, per: pageSize })} className="text-xs text-gray-500 underline hover:text-gray-700">
                Clear all
              </Link>
            )}
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
            <CatalogControls sort={sort} inStock={inStock} perPage={pageSize} soldBy={soldBy ?? ''} caseSize={caseSize?.value ?? ''} />
          </Suspense>
        </div>

        <ProductGrid products={pagedProducts} didYouMean={didYouMean} />

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
