import { supabase } from '@/lib/supabase'
import { departmentPhotos, type NavCategory, type PhotoCandidate } from '@/lib/category-groups'

// Photos for the home page's department tiles (lib/category-groups.ts
// departmentPhotos). Cached per server instance for 10 minutes, like the
// menu counts; null on error and the tiles show without photos.
const TTL_MS = 10 * 60 * 1000
let cached: { at: number; photos: Record<string, string> } | null = null

export async function loadDepartmentPhotos(categories: NavCategory[]): Promise<Record<string, string> | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.photos
  try {
    const rows: PhotoCandidate[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('products')
        .select('id, category_id, image_url, needs_photo, stock_qty')
        .eq('is_active', true)
        .eq('manually_hidden', false)
        .order('id')
        .range(from, from + 999)
      if (error) throw error
      rows.push(...((data ?? []) as PhotoCandidate[]))
      if (!data || data.length < 1000) break
    }
    const photos = departmentPhotos(rows, categories)
    cached = { at: Date.now(), photos }
    return photos
  } catch (err) {
    console.error('[department-tiles] load failed:', err instanceof Error ? err.message : err)
    return null
  }
}
