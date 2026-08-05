'use client'

/**
 * Client-side favorites list — React Context backed by localStorage.
 *
 * Stores a minimal product snapshot so the /favorites page renders without
 * any API call. Survives reloads/tab close. Pattern mirrors cart-context.tsx.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

const STORAGE_KEY = 'lyu_favorites'

export interface FavoriteItem {
  id: string
  sku: string
  name: string
  price_cents: number
  image_url: string | null
  category: string
}

interface FavoritesContextValue {
  favorites: FavoriteItem[]
  toggle: (item: FavoriteItem) => void
  isFavorite: (id: string) => boolean
  count: number
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

function readStorage(): FavoriteItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (i) =>
        i &&
        typeof i.id === 'string' &&
        typeof i.sku === 'string' &&
        typeof i.name === 'string' &&
        typeof i.price_cents === 'number',
    )
  } catch {
    return []
  }
}

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFavorites(readStorage())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
    } catch {
      // Storage full / disabled — favorites still work for this session.
    }
  }, [favorites, hydrated])

  const toggle = useCallback((item: FavoriteItem) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.id === item.id)
      return exists ? prev.filter((f) => f.id !== item.id) : [...prev, item]
    })
  }, [])

  const isFavorite = useCallback(
    (id: string) => favorites.some((f) => f.id === id),
    [favorites],
  )

  const count = favorites.length

  const value = useMemo<FavoritesContextValue>(
    () => ({ favorites, toggle, isFavorite, count }),
    [favorites, toggle, isFavorite, count],
  )

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavorites must be used within a FavoritesProvider')
  return ctx
}
