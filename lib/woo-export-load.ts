import type { getAdminClient } from '@/lib/supabase'
import type { ExportProduct } from '@/lib/woo-export'

// Loads what /admin/woo-export needs: active products and each one's category
// name (category_id, else its first product_categories link).

type Db = ReturnType<typeof getAdminClient>

export async function loadExportData(db: Db) {
  const products: ExportProduct[] = []
  // Ordered by id: range() paging over a non-unique sort drops rows.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id, sku, name, description, image_url, image_urls, needs_photo, price_cents, stock_qty, is_active, manually_hidden, category_id')
      .eq('is_active', true)
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    products.push(...((data ?? []) as ExportProduct[]))
    if (!data || data.length < 1000) break
  }
  // A product can be placed by a product_categories row with a null
  // category_id (lib/cleanup.ts); use that link as the fallback.
  const linked = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('product_categories')
      .select('product_id, category_id')
      .order('product_id')
      .order('category_id')
      .range(from, from + 999)
    if (error) throw error
    for (const r of data ?? []) if (!linked.has(String(r.product_id))) linked.set(String(r.product_id), String(r.category_id))
    if (!data || data.length < 1000) break
  }
  const { data: cats, error: catErr } = await db.from('categories').select('id, name')
  if (catErr) throw catErr
  const catName = new Map((cats ?? []).map((c) => [String(c.id), String(c.name)]))
  const categoryOf = (p: ExportProduct) => catName.get(p.category_id ?? linked.get(p.id) ?? '') ?? null
  return { products, categoryOf }
}
