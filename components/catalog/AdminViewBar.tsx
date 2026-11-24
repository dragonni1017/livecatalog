'use client'

import { usePathname, useSearchParams } from 'next/navigation'

// Shown on every storefront page while an admin has "show all products" on
// (lib/admin-catalog-view.ts). Turning it off posts back so the page returns
// to exactly what customers see.
export default function AdminViewBar() {
  const pathname = usePathname()
  const search = useSearchParams()
  const from = `${pathname}${search.size ? `?${search.toString()}` : ''}`
  return (
    <div className="border-b border-amber-300 bg-amber-50 print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs text-amber-900 sm:px-6 lg:px-8">
        <span>
          <span className="font-semibold">Admin view:</span> showing every product, including hidden and inactive ones.
          Customers don&apos;t see the ones marked Hidden or Inactive.
        </span>
        <form action="/admin/api/storefront-view" method="post">
          <input type="hidden" name="from" value={from} />
          <button type="submit" className="font-medium underline hover:text-amber-700">
            Show what customers see
          </button>
        </form>
      </div>
    </div>
  )
}
