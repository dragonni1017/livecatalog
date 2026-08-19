'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Props {
  sort: string
  inStock: boolean
  perPage: number
}

const SORT_OPTIONS = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'price_asc', label: 'Price (low → high)' },
  { value: 'price_desc', label: 'Price (high → low)' },
  { value: 'newest', label: 'Newest' },
  { value: 'sku', label: 'SKU (A–Z)' },
]

const PER_PAGE_OPTIONS = [20, 50, 100]
const DEFAULT_PER_PAGE = 20

// Sort dropdown + "in stock only" toggle for the catalog. Writes the choice to
// the URL (?sort= / ?instock=) and resets to page 1, mirroring SearchInput so
// the server component can read it back and re-query.
export default function CatalogControls({ sort, inStock, perPage }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function update(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    params.delete('page') // any control change returns to the first page
    const qs = params.toString()
    router.push(qs ? `/?${qs}` : '/')
  }

  return (
    <div className="flex items-center gap-3">
      <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-600 select-none">
        <input
          type="checkbox"
          checked={inStock}
          onChange={(e) =>
            update((p) => (e.target.checked ? p.set('instock', '1') : p.delete('instock')))
          }
          className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
        />
        In stock only
      </label>

      <label className="flex items-center gap-1.5 text-sm text-gray-600">
        <span className="hidden sm:inline">Sort</span>
        <select
          value={sort}
          onChange={(e) =>
            update((p) => (e.target.value === 'name' ? p.delete('sort') : p.set('sort', e.target.value)))
          }
          className="rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-sm text-gray-600">
        <span className="hidden sm:inline">Show</span>
        <select
          value={perPage}
          onChange={(e) =>
            update((p) =>
              Number(e.target.value) === DEFAULT_PER_PAGE ? p.delete('per') : p.set('per', e.target.value),
            )
          }
          className="rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        >
          {PER_PAGE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
