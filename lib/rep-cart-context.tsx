'use client'

/**
 * Client-side cart for the rep order-builder — same shape/behavior as
 * lib/cart-context.tsx, but under its own localStorage key so a rep's
 * in-progress order never collides with a public shopper's cart on the same
 * browser/machine. See that file for the fuller design comment; kept as a
 * separate small context rather than parameterizing the public one so the
 * two stay independently editable without risking the public cart.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { CartItem } from '@/lib/types'

const STORAGE_KEY = 'livecatalog_rep_cart_v1'

interface RepCartContextValue {
  items: CartItem[]
  count: number
  subtotalCents: number
  addItem: (item: Omit<CartItem, 'qty'>, qty?: number) => void
  removeItem: (productId: string) => void
  setQty: (productId: string, qty: number) => void
  clear: () => void
  hydrated: boolean
}

const RepCartContext = createContext<RepCartContextValue | null>(null)

function readStorage(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (i) =>
        i &&
        typeof i.productId === 'string' &&
        typeof i.priceCents === 'number' &&
        typeof i.qty === 'number' &&
        i.qty > 0,
    )
  } catch {
    return []
  }
}

export function RepCartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(readStorage())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      // Storage full / disabled — cart still works for this session.
    }
  }, [items, hydrated])

  const addItem = useCallback((item: Omit<CartItem, 'qty'>, qty = 1) => {
    if (qty <= 0) return
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === item.productId)
      if (existing) {
        return prev.map((i) =>
          i.productId === item.productId ? { ...i, qty: i.qty + qty } : i,
        )
      }
      return [...prev, { ...item, qty }]
    })
  }, [])

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId))
  }, [])

  const setQty = useCallback((productId: string, qty: number) => {
    setItems((prev) =>
      qty <= 0
        ? prev.filter((i) => i.productId !== productId)
        : prev.map((i) => (i.productId === productId ? { ...i, qty } : i)),
    )
  }, [])

  const clear = useCallback(() => setItems([]), [])

  const { count, subtotalCents } = useMemo(() => {
    let count = 0
    let subtotalCents = 0
    for (const i of items) {
      count += i.qty
      subtotalCents += i.priceCents * i.qty
    }
    return { count, subtotalCents }
  }, [items])

  const value = useMemo<RepCartContextValue>(
    () => ({ items, count, subtotalCents, addItem, removeItem, setQty, clear, hydrated }),
    [items, count, subtotalCents, addItem, removeItem, setQty, clear, hydrated],
  )

  return <RepCartContext.Provider value={value}>{children}</RepCartContext.Provider>
}

export function useRepCart(): RepCartContextValue {
  const ctx = useContext(RepCartContext)
  if (!ctx) throw new Error('useRepCart must be used within a RepCartProvider')
  return ctx
}
