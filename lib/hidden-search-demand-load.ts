import { getAdminClient } from '@/lib/supabase'
import { hiddenSearchDemand, NO_RESULTS_PREFIX, type DemandEvent, type HiddenDemandRow } from '@/lib/hidden-search-demand'

type Db = ReturnType<typeof getAdminClient>

export interface HiddenDemandProduct {
  id: string
  sku: string
  name: string
  barcode: string | null
  price_cents: number | null
  stock_qty: number | null
  image_url: string | null
}

const PAGE = 1000

/** Every zero-result search event, paged (there are more than one page). Null on error. */
export async function loadNoResultEvents(db: Db): Promise<DemandEvent[] | null> {
  const out: DemandEvent[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('analytics_events')
      .select('term, created_at')
      .eq('type', 'search')
      .like('term', `${NO_RESULTS_PREFIX}%`)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('[hidden-search-demand] events:', error.message)
      return null
    }
    out.push(...((data ?? []) as DemandEvent[]))
    if (!data || data.length < PAGE) return out
  }
}

/** Active products hidden from the storefront. Null on error. */
async function loadHiddenProducts(db: Db): Promise<HiddenDemandProduct[] | null> {
  const out: HiddenDemandProduct[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('products')
      .select('id, sku, name, barcode, price_cents, stock_qty, image_url')
      .eq('is_active', true)
      .eq('manually_hidden', true)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('[hidden-search-demand] products:', error.message)
      return null
    }
    out.push(...((data ?? []) as HiddenDemandProduct[]))
    if (!data || data.length < PAGE) return out
  }
}

export async function loadHiddenSearchDemand(
  db: Db,
  events?: DemandEvent[] | null,
): Promise<HiddenDemandRow<HiddenDemandProduct>[] | null> {
  const [ev, hidden] = await Promise.all([events ?? loadNoResultEvents(db), loadHiddenProducts(db)])
  if (!ev || !hidden) return null
  return hiddenSearchDemand(ev, hidden)
}
