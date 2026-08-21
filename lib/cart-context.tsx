'use client'

/**
 * Client-side shopping cart — React Context backed by localStorage.
 *
 * No DB writes happen here; the cart lives entirely in the browser until the
 * customer submits on /cart (POST /api/orders). It survives reloads/tab close
 * and is cleared on a successful submit. Prices held here are a snapshot for
 * display only — the server re-fetches the authoritative price on submit.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { CartItem } from './types'

const STORAGE_KEY = 'livecatalog_cart_v1'

interface CartContextValue {
  items: CartItem[]
  count: number
  subtotalCents: number
  addItem: (item: Omit<CartItem, 'qty'>, qty?: number) => void
  removeItem: (productId: string) => void
  setQty: (productId: string, qty: number) => void
  updatePrices: (prices: Record<string, number>) => void
  clear: () => void
  hydrated: boolean
}

const CartContext = createContext<CartContextValue | null>(null)

function readStorage(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Defensive: only keep entries that look like cart items.
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

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])
  // Avoid a hydration mismatch: start empty on both server and first client
  // render, then load from localStorage in an effect.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // One-time hydration: localStorage can't be read on the server, so we load
    // it after mount. This is the intended "sync from external store on mount"
    // case, not a reactive setState loop (deps are []).
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

  // Re-syncs stored priceCents against a fresh authoritative quote (see
  // POST /api/cart/reprice) without touching qty or any other field. Bails
  // out to the same `prev` reference when nothing actually changed, so a
  // no-op reprice (the common case) doesn't trigger a re-render or an
  // unnecessary localStorage write.
  const updatePrices = useCallback((prices: Record<string, number>) => {
    setItems((prev) => {
      let changed = false
      const next = prev.map((i) => {
        const p = prices[i.productId]
        if (p !== undefined && p !== i.priceCents) {
          changed = true
          return { ...i, priceCents: p }
        }
        return i
      })
      return changed ? next : prev
    })
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

  const value = useMemo<CartContextValue>(
    () => ({ items, count, subtotalCents, addItem, removeItem, setQty, updatePrices, clear, hydrated }),
    [items, count, subtotalCents, addItem, removeItem, setQty, updatePrices, clear, hydrated],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
