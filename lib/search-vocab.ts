import { supabase } from '@/lib/supabase'
import { buildVocabulary } from '@/lib/search-terms'

// Words from visible product names, for "Did you mean". Loaded only when a
// search finds nothing, and kept per server instance for a while so a run
// of empty searches doesn't page through every product each time.
const TTL_MS = 10 * 60 * 1000
let cached: { at: number; vocab: Map<string, number> } | null = null

export async function loadSearchVocabulary(): Promise<Map<string, number> | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.vocab
  const names: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('name')
      .eq('is_active', true)
      .eq('manually_hidden', false)
      .order('id')
      .range(from, from + 999)
    if (error) {
      console.error('[search-vocab] load failed:', error.message)
      return null
    }
    for (const p of data ?? []) if (p.name) names.push(p.name)
    if (!data || data.length < 1000) break
  }
  cached = { at: Date.now(), vocab: buildVocabulary(names) }
  return cached.vocab
}
