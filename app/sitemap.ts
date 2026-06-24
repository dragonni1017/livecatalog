import type { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'

const BASE = 'https://livecatalog.vercel.app'

// Regenerated hourly so newly synced products get indexed without a redeploy.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: 'daily', priority: 1 },
  ]

  // Categories (browsed via /?category=<slug>)
  const { data: categories } = await supabase.from('categories').select('slug')
  for (const c of categories ?? []) {
    entries.push({ url: `${BASE}/?category=${c.slug}`, changeFrequency: 'weekly', priority: 0.6 })
  }

  // Every publicly visible product. PostgREST caps a select at 1000 rows, so
  // page through in 1000-row batches until a short page signals the end.
  try {
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('products')
        .select('id, updated_at')
        .eq('is_active', true)
        .eq('manually_hidden', false)
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) throw error
      const rows = data ?? []
      for (const p of rows) {
        entries.push({
          url: `${BASE}/product/${p.id}`,
          lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
          changeFrequency: 'weekly',
          priority: 0.8,
        })
      }
      if (rows.length < PAGE) break
    }
  } catch (err) {
    console.error('[sitemap] failed to load products:', err)
  }

  return entries
}
