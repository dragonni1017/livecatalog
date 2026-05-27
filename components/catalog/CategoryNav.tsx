'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Category } from '@/lib/types'

interface CategoryNavProps {
  categories: Category[]
  activeSlug?: string
}

export default function CategoryNav({ categories, activeSlug }: CategoryNavProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleCategoryClick(slug: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (slug) {
      params.set('category', slug)
    } else {
      params.delete('category')
    }
    // Reset to page root when changing category
    router.push(`/?${params.toString()}`)
  }

  const allActive = !activeSlug

  return (
    <>
      {/* Mobile: horizontal scrollable strip */}
      <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
        <button
          onClick={() => handleCategoryClick(null)}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            allActive
              ? 'bg-red-600 text-white'
              : 'bg-white text-gray-600 border border-gray-200 hover:border-red-300 hover:text-red-600'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryClick(cat.slug)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              activeSlug === cat.slug
                ? 'bg-red-600 text-white'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-red-300 hover:text-red-600'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Desktop: vertical sidebar list */}
      <nav className="hidden lg:flex lg:flex-col lg:gap-1">
        <button
          onClick={() => handleCategoryClick(null)}
          className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
            allActive
              ? 'bg-red-50 text-red-700'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          All Products
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryClick(cat.slug)}
            className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeSlug === cat.slug
                ? 'bg-red-50 text-red-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </nav>
    </>
  )
}
