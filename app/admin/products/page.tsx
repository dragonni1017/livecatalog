import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import ProductVisibilityToggle from '@/components/admin/ProductVisibilityToggle'

export const dynamic = 'force-dynamic'

interface AdminProduct {
  id: string
  sku: string | null
  name: string
  image_url: string | null
  is_active: boolean
  manually_hidden: boolean
}

export default async function AdminProductsPage() {
  const db = getAdminClient()
  const { data } = await db
    .from('products')
    .select('id, sku, name, image_url, is_active, manually_hidden')
    .order('name')

  const products = (data ?? []) as AdminProduct[]
  const total = products.length
  const hiddenCount = products.filter((p) => p.manually_hidden).length
  const noImageCount = products.filter((p) => !p.image_url || p.image_url.trim() === '').length

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
              ← Back to Dashboard
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Manage Product Visibility</h1>
          </div>
        </div>

        {/* Counts */}
        <div className="mb-6 flex flex-wrap gap-4 text-sm">
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{total.toLocaleString()}</span> total
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{hiddenCount.toLocaleString()}</span> hidden
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{noImageCount.toLocaleString()}</span> without image
          </span>
        </div>

        {/* Table */}
        <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
          <div className="overflow-auto max-h-[640px]">
            <table className="w-full text-sm text-left">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Image</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Active</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Visibility</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.map((p) => {
                  const hasImage = !!p.image_url && p.image_url.trim() !== ''
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-3">
                        {hasImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.image_url as string}
                            alt={p.name}
                            className="h-12 w-12 rounded object-cover bg-gray-100"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-100 text-[10px] text-gray-400">
                            No image
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-800 max-w-[280px] truncate">{p.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{p.sku || '—'}</td>
                      <td className="px-4 py-3">
                        {p.is_active ? (
                          <span className="text-xs font-medium text-green-600">Active</span>
                        ) : (
                          <span className="text-xs font-medium text-gray-400">Inactive</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ProductVisibilityToggle id={p.id} initialHidden={p.manually_hidden} />
                      </td>
                    </tr>
                  )
                })}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                      No products found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
