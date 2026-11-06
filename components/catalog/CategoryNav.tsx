'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Category } from '@/lib/types'
import { departmentOf, departmentSlug, groupCategories, type CategoryCounts } from '@/lib/category-groups'

interface CategoryNavProps {
  categories: Category[]
  activeSlug?: string
  /** Live curated/seasonal collections (lib/collections.ts loadLiveCollections). */
  collections?: { slug: string; name: string }[]
  /** Products showing per category/department (lib/category-counts.ts); null = no numbers, nothing hidden. */
  counts?: CategoryCounts | null
  /** ?dept= slug when a whole department is being viewed. */
  activeDept?: string
}

// The 43 categories grouped into departments (lib/category-groups.ts), with
// counts, empty categories hidden. Desktop: a sidebar whose departments open
// and close. Phones: the specials stay as pills, and one "Categories" button
// opens the same grouped list as wrapped pills instead of a 50-item strip.
export default function CategoryNav({ categories, activeSlug, collections = [], counts = null, activeDept }: CategoryNavProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const isNewArrivals = pathname === '/new-arrivals'
  const isBestSellers = pathname === '/best-sellers'
  const activeCollection = pathname.startsWith('/collections/') ? pathname.slice('/collections/'.length) : null

  const departments = groupCategories(categories, counts, activeSlug)
  const activeCat = categories.find((c) => c.slug === activeSlug)
  const activeDeptName = departments.find((d) => departmentSlug(d.name) === activeDept)?.name
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(activeCat ? [departmentOf(activeCat.name)] : activeDeptName ? [activeDeptName] : []),
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  // A category and a whole department are alternatives: picking one clears the other.
  function handleCategoryClick(slug: string | null, dept: string | null = null) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('category')
    params.delete('dept')
    if (slug) params.set('category', slug)
    else if (dept) params.set('dept', dept)
    params.delete('page') // reset to page 1 on category change
    router.push(`/?${params.toString()}`)
    // Query-string-only navigation (same pathname) doesn't trigger Next's
    // scroll-to-top -- without this, switching category while scrolled deep
    // into a grid leaves the user stranded mid-page on the new content.
    window.scrollTo({ top: 0 })
    setMobileOpen(false)
  }

  function toggle(name: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const allActive = !activeSlug && !activeDeptName && !isNewArrivals && !isBestSellers && !activeCollection
  const pill = (active: boolean) =>
    `shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
      active ? 'bg-red-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-red-300 hover:text-red-600'
    }`
  const row = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
      active ? 'bg-red-50 text-red-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`
  const num = (n: number | null) => (n == null ? null : <span className="text-xs font-normal text-gray-400">{n}</span>)

  return (
    <>
      {/* Phones: specials as pills, plus one button that opens the grouped list */}
      <div className="lg:hidden">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button type="button" onClick={() => setMobileOpen((v) => !v)} aria-expanded={mobileOpen} className={pill(mobileOpen || !!activeSlug || !!activeDeptName)}>
            {activeCat ? activeCat.name : activeDeptName ? `All ${activeDeptName}` : 'Categories'} {mobileOpen ? '▴' : '▾'}
          </button>
          <Link href="/new-arrivals" className={`flex items-center gap-1.5 ${pill(isNewArrivals)}`}>
            <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
            New
          </Link>
          <Link href="/best-sellers" className={pill(isBestSellers)}>
            Best Sellers
          </Link>
          {collections.map((c) => (
            <Link key={c.slug} href={`/collections/${c.slug}`} className={pill(activeCollection === c.slug)}>
              {c.name}
            </Link>
          ))}
        </div>
        {mobileOpen && (
          <div className="mt-2 space-y-3 rounded-xl border border-gray-200 bg-white p-3">
            <button type="button" onClick={() => handleCategoryClick(null)} className={pill(allActive)}>
              All Products
            </button>
            {departments.map((d) => (
              <div key={d.name}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {d.name} {d.count != null && <span className="font-normal text-gray-400">({d.count})</span>}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {d.categories.length > 1 && (
                    <button type="button" onClick={() => handleCategoryClick(null, departmentSlug(d.name))} className={pill(activeDeptName === d.name)}>
                      All {d.name}
                    </button>
                  )}
                  {d.categories.map((cat) => (
                    <button key={cat.id} type="button" onClick={() => handleCategoryClick(cat.slug)} className={pill(activeSlug === cat.slug)}>
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: sidebar with departments that open and close */}
      <nav className="hidden lg:flex lg:flex-col lg:gap-1">
        <Link href="/new-arrivals" className={row(isNewArrivals)}>
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
            New Arrivals
          </span>
        </Link>
        {/* Best Sellers — special item, computed from view analytics rather
            than a real category */}
        <Link href="/best-sellers" className={row(isBestSellers)}>
          Best Sellers
        </Link>
        {collections.map((c) => (
          <Link key={c.slug} href={`/collections/${c.slug}`} className={row(activeCollection === c.slug)}>
            {c.name}
          </Link>
        ))}

        <button type="button" onClick={() => handleCategoryClick(null)} className={`mt-2 ${row(allActive)}`}>
          All Products
        </button>
        {departments.map((d) => {
          // A department with one category is just that category.
          if (d.categories.length === 1) {
            const cat = d.categories[0]
            return (
              <button key={d.name} type="button" onClick={() => handleCategoryClick(cat.slug)} className={row(activeSlug === cat.slug)}>
                <span>{cat.name}</span>
                {num(cat.count)}
              </button>
            )
          }
          const isOpen = open.has(d.name)
          const holdsActive = d.categories.some((c) => c.slug === activeSlug) || activeDeptName === d.name
          return (
            <div key={d.name}>
              <button type="button" onClick={() => toggle(d.name)} aria-expanded={isOpen} className={row(holdsActive && !isOpen)}>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 text-xs text-gray-400">{isOpen ? '▾' : '▸'}</span>
                  {d.name}
                </span>
                {num(d.count)}
              </button>
              {isOpen && (
                <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-gray-200 pl-2">
                  <button type="button" onClick={() => handleCategoryClick(null, departmentSlug(d.name))} className={row(activeDeptName === d.name)}>
                    <span>All {d.name}</span>
                    {num(d.count)}
                  </button>
                  {d.categories.map((cat) => (
                    <button key={cat.id} type="button" onClick={() => handleCategoryClick(cat.slug)} className={row(activeSlug === cat.slug)}>
                      <span>{cat.name}</span>
                      {num(cat.count)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </>
  )
}
