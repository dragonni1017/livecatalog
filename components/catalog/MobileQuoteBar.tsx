'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCart } from '@/lib/cart-context'

// Phones only: a slim bar pinned to the bottom while browsing, so the quote
// is one tap away instead of a scroll back up to the header cart icon.
// Shows once something is in the quote; never on the cart, order, account or
// form pages, where it would cover the page's own buttons. A spacer of the
// same height keeps it from covering the footer.

const BROWSE = ['/new-arrivals', '/best-sellers', '/collections', '/category', '/product', '/favorites']

export function showsQuoteBar(pathname: string): boolean {
  return pathname === '/' || BROWSE.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export default function MobileQuoteBar() {
  // Count only: the quote page can reprice (tiers, volume), so a total here could disagree with it.
  const { count, hydrated } = useCart()
  const pathname = usePathname()
  if (!hydrated || count === 0 || !showsQuoteBar(pathname)) return null

  return (
    <>
      <div className="h-16 sm:hidden" aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] backdrop-blur sm:hidden">
        <Link
          href="/cart"
          className="flex w-full items-center justify-between rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white active:bg-red-700"
        >
          <span>
            {count} item{count === 1 ? '' : 's'} in your quote
          </span>
          <span>View quote →</span>
        </Link>
      </div>
    </>
  )
}
