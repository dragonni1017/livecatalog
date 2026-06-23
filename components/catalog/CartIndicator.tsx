'use client'

import Link from 'next/link'
import { useCart } from '@/lib/cart-context'

export default function CartIndicator() {
  const { count, hydrated } = useCart()

  return (
    <Link
      href="/cart"
      aria-label={`Cart${count > 0 ? `, ${count} item${count === 1 ? '' : 's'}` : ' (empty)'}`}
      className="relative inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-gray-700 hover:text-red-600"
    >
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
        />
      </svg>
      {hydrated && count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white">
          {count}
        </span>
      )}
    </Link>
  )
}
