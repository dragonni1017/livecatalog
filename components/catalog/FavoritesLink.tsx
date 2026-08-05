'use client'

import Link from 'next/link'
import { useFavorites } from '@/lib/favorites-context'

export default function FavoritesLink() {
  const { count } = useFavorites()
  return (
    <Link
      href="/favorites"
      className="hidden text-xs font-medium text-gray-600 hover:text-red-600 sm:block"
    >
      {count > 0 ? `Saved (${count})` : 'Saved'}
    </Link>
  )
}
