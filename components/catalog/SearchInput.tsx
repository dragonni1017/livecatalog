'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import BarcodeScanner from './BarcodeScanner'

interface SuggestResult {
  id: string
  sku: string
  name: string
  price_cents: number
  image_url: string | null
  category_name: string | null
}

export default function SearchInput() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Controlled input value — initialized from URL on mount
  const [value, setValue] = useState(searchParams.get('q') ?? '')
  const [results, setResults] = useState<SuggestResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)

  // Track which zero-result queries we've already fired so we don't double-fire
  const firedNoResults = useRef(new Set<string>())
  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Sync input value when URL changes externally (e.g. browser back/forward).
  // We use a ref to track the last URL-sourced value so we only update when it
  // genuinely changes from outside (not from the user typing), avoiding an
  // infinite-loop or cascading-render lint violation.
  const lastUrlQ = useRef(searchParams.get('q') ?? '')
  const urlQ = searchParams.get('q') ?? ''
  if (urlQ !== lastUrlQ.current) {
    lastUrlQ.current = urlQ
    // Synchronous state update during render (not in an effect) is the React 18
    // recommended pattern for derived-state updates triggered by prop/context changes.
    setValue(urlQ)
  }

  // Click-outside handler: hide dropdown when user clicks away
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setHighlightIdx(-1)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Debounced suggest fetch — 250ms after typing stops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSuggest = useCallback(
    debounce(async (q: string) => {
      if (q.length < 2) {
        setResults([])
        setOpen(false)
        setLoading(false)
        return
      }

      // Cancel any in-flight request
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setLoading(true)
      try {
        const res = await fetch(`/api/products/suggest?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        })
        const data: { results: SuggestResult[] } = await res.json()
        setResults(data.results)
        setOpen(true)
        setHighlightIdx(-1)

        // Zero-results tracking — fire once per unique query
        if (data.results.length === 0 && !firedNoResults.current.has(q)) {
          firedNoResults.current.add(q)
          fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'search_no_results', query: q }),
          }).catch(() => {})
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        setResults([])
        setOpen(false)
      } finally {
        setLoading(false)
      }
    }, 250),
    []
  )

  // Debounced URL update (existing behavior) — 300ms, updates catalog grid
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedUpdate = useCallback(
    debounce((query: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (query) {
        params.set('q', query)
      } else {
        params.delete('q')
      }
      params.delete('page')
      router.push(`/?${params.toString()}`)

      if (query.trim().length >= 2) {
        fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'search', term: query }),
          keepalive: true,
        }).catch(() => {})
      }
    }, 300),
    [searchParams, router]
  )

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newValue = e.target.value
    setValue(newValue)
    debouncedSuggest(newValue)
    debouncedUpdate(newValue)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx(prev => (prev + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(prev => (prev <= 0 ? results.length - 1 : prev - 1))
    } else if (e.key === 'Enter') {
      if (highlightIdx >= 0 && results[highlightIdx]) {
        e.preventDefault()
        navigateToProduct(results[highlightIdx].id)
      }
      // If no highlight, let the form submit naturally (existing URL search)
      setOpen(false)
      setHighlightIdx(-1)
    } else if (e.key === 'Escape') {
      setOpen(false)
      setHighlightIdx(-1)
    }
  }

  function navigateToProduct(id: string) {
    setOpen(false)
    setHighlightIdx(-1)
    router.push(`/product/${id}`)
  }

  function handleScan(barcode: string) {
    setValue(barcode)
    setOpen(false)
    setHighlightIdx(-1)
    router.push(`/?q=${encodeURIComponent(barcode)}`)
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="flex items-center gap-2">
        {/* Search input with magnifying glass icon */}
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <svg
              className="h-4 w-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            type="search"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (results.length > 0) setOpen(true) }}
            placeholder="Search by name or SKU..."
            autoComplete="off"
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />

          {/* Loading spinner — shown inside input right side while fetching */}
          {loading && (
            <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-red-500" />
            </div>
          )}
        </div>

        {/* Barcode scanner button */}
        <BarcodeScanner onScan={handleScan} />
      </div>

      {/* Autosuggest dropdown */}
      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden"
        >
          {results.map((item, idx) => (
            <li
              key={item.id}
              role="option"
              aria-selected={idx === highlightIdx}
              onMouseDown={() => navigateToProduct(item.id)}
              onMouseEnter={() => setHighlightIdx(idx)}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${
                idx === highlightIdx ? 'bg-red-50' : 'hover:bg-gray-50'
              }`}
            >
              {/* Product image or placeholder */}
              <div className="flex-shrink-0 w-10 h-10 rounded overflow-hidden bg-gray-100">
                {item.image_url ? (
                  <Image
                    src={item.image_url}
                    alt={item.name}
                    width={40}
                    height={40}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200" />
                )}
              </div>

              {/* Name + SKU + category */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                <p className="text-xs text-gray-500 truncate">SKU: {item.sku}</p>
              </div>

              {/* Category badge */}
              {item.category_name && (
                <span className="flex-shrink-0 text-xs bg-gray-100 text-gray-600 rounded px-2 py-0.5">
                  {item.category_name}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Simple debounce utility
function debounce<T extends unknown[]>(fn: (...args: T) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout>
  return (...args: T) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}
