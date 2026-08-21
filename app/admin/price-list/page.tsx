import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import PrintButton from '@/components/admin/PrintButton'
import type { Category, Product } from '@/lib/types'

export const dynamic = 'force-dynamic'

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

interface PriceListPageProps {
  searchParams: Promise<{ category?: string }>
}

// Printable wholesale price list grouped by category. Back-office tool: print or
// Save-as-PDF to email/hand to reps and customers. Optional ?category=<slug>
// narrows it to one category.
export default async function PriceListPage({ searchParams }: PriceListPageProps) {
  const { category } = await searchParams

  const { data: catData } = await supabase.from('categories').select('*').order('display_order')
  const categories = (catData ?? []) as Category[]
  const activeCat = category ? categories.find((c) => c.slug === category) : undefined

  // Page through products (PostgREST caps at 1000 rows).
  const PAGE = 1000
  const products: Product[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('products')
      .select('*, category:categories!products_category_id_fkey(*)')
      .eq('is_active', true)
      .eq('manually_hidden', false)
    if (activeCat) q = q.eq('category_id', activeCat.id)
    const { data, error } = await q.order('name').range(from, from + PAGE - 1)
    if (error) break
    const rows = (data ?? []) as Product[]
    products.push(...rows)
    if (rows.length < PAGE) break
  }

  // Group by category name for printing.
  const groups = new Map<string, Product[]>()
  for (const p of products) {
    const key = p.category?.name ?? 'Uncategorized'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }
  const groupNames = [...groups.keys()].sort()

  return (
    <div className="mx-auto max-w-4xl bg-white p-8 text-gray-900 print:max-w-none print:p-0">
      {/* Toolbar — hidden on print */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Dashboard
        </Link>
        <div className="flex items-center gap-3">
          <form>
            <select
              name="category"
              defaultValue={category ?? ''}
              className="rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="submit" className="ml-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              Apply
            </button>
          </form>
          <PrintButton />
        </div>
      </div>

      {/* Document header */}
      <header className="border-b-2 border-gray-900 pb-3">
        <h1 className="text-xl font-bold">L &amp; Y USA — Wholesale Price List</h1>
        <p className="text-sm text-gray-600">
          626-552-4120 · www.ly-usa.com{activeCat ? ` · ${activeCat.name}` : ''} · {products.length} items
        </p>
      </header>

      {groupNames.map((name) => (
        <section key={name} className="mt-6 break-inside-avoid">
          <h2 className="mb-2 border-b border-gray-300 pb-1 text-sm font-bold uppercase tracking-wide text-gray-700">
            {name}
          </h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {groups.get(name)!.map((p) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-3 font-mono text-xs text-gray-500 align-top whitespace-nowrap">{p.sku}</td>
                  <td className="py-1.5 pr-3">{p.name}</td>
                  <td className="py-1.5 text-right font-semibold whitespace-nowrap">{formatPrice(p.price_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {products.length === 0 && <p className="mt-8 text-sm text-gray-400">No products found.</p>}
    </div>
  )
}
