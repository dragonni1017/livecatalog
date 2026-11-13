import { getAdminClient } from '@/lib/supabase'
import { isEmailConfigured } from '@/lib/email'
import { isLowStockEmailEnabled } from '@/lib/alert-settings'
import { NO_RESULTS_PREFIX, type DemandEvent } from '@/lib/hidden-search-demand'
import {
  heldPricesCheck, lowStockEmailCheck, priceDisplayCheck, searchCheck, staleReviewCheck, summarizeSearches,
  syncCheck, visibleProductsCheck, LEVEL_ORDER,
  type Check, type CodeLookup, type SearchSummary, type SyncRun, type VisibleProduct,
} from '@/lib/catalog-health'

type Db = ReturnType<typeof getAdminClient>

const PAGE = 1000
export const SEARCH_DAYS = 7

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

// One failed query drops its check (logged) instead of failing the page.
async function safe<T>(label: string, f: () => Promise<T>): Promise<T | null> {
  try {
    return await f()
  } catch (e) {
    console.error(`[catalog-health] ${label}:`, e instanceof Error ? e.message : e)
    return null
  }
}

export interface CatalogHealth {
  checks: Check[]
  search: SearchSummary | null
  failed: string[]
}

export async function loadCatalogHealth(db: Db, nowMs = Date.now()): Promise<CatalogHealth> {
  const since = new Date(nowMs - SEARCH_DAYS * 86_400_000).toISOString()
  const [visible, syncRow, held, pending, display, switchOn, codes, zero, totalSearches] = await Promise.all([
    safe('visible products', () => pageAll<VisibleProduct>((a, b) =>
      db.from('products').select('id, sku, name, price_cents, image_url, needs_photo').eq('is_active', true).eq('manually_hidden', false).order('sku').range(a, b))),
    safe('sync run', async () => {
      const { data, error } = await db.from('sync_runs').select('started_at, status, updated, error_count, details').order('started_at', { ascending: false }).limit(1)
      if (error) throw new Error(error.message)
      // Wrapped, so "no run yet" (run: null) differs from a failed query (null).
      return { run: (data?.[0] ?? null) as SyncRun | null }
    }),
    safe('held prices', async () => {
      const { count, error } = await db.from('products').select('id', { count: 'exact' }).gt('held_price_cents', 0).limit(1)
      if (error) throw new Error(error.message)
      return count ?? 0
    }),
    safe('review queue', async () => {
      const items = await pageAll<{ sku: string; product_id: string | null; suggested_cents: number | null }>((a, b) =>
        db.from('price_review_items').select('sku, product_id, suggested_cents').eq('status', 'pending').range(a, b))
      const ids = items.map((i) => i.product_id).filter((x): x is string => !!x)
      const live = new Map<string, number | null>()
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await db.from('products').select('id, price_cents').in('id', ids.slice(i, i + 200))
        if (error) throw new Error(error.message)
        for (const p of data ?? []) live.set(p.id, p.price_cents)
      }
      return items.map((i) => ({ sku: i.sku, suggested_cents: i.suggested_cents, live_cents: i.product_id ? live.get(i.product_id) ?? null : null }))
    }),
    safe('display settings', async () => {
      const { data, error } = await db.from('display_settings').select('show_price_listing, show_price_detail').eq('id', 1).single()
      if (error) throw new Error(error.message)
      return data as { show_price_listing: boolean; show_price_detail: boolean }
    }),
    safe('low-stock switch', () => isLowStockEmailEnabled(db)),
    safe('product codes', async () => {
      const rows = await pageAll<{ sku: string; barcode: string | null; is_active: boolean; manually_hidden: boolean }>((a, b) =>
        db.from('products').select('sku, barcode, is_active, manually_hidden').order('id').range(a, b))
      const map = new Map<string, 'visible' | 'hidden' | 'inactive'>()
      for (const r of rows) {
        const where = !r.is_active ? 'inactive' : r.manually_hidden ? 'hidden' : 'visible'
        for (const c of [r.sku, r.barcode]) if (c?.trim()) map.set(c.trim().toLowerCase(), where)
      }
      return map
    }),
    safe('zero-result searches', () => pageAll<DemandEvent>((a, b) =>
      db.from('analytics_events').select('term, created_at').eq('type', 'search').like('term', `${NO_RESULTS_PREFIX}%`).gte('created_at', since).range(a, b))),
    safe('search count', async () => {
      const { count, error } = await db.from('analytics_events').select('id', { count: 'exact' }).eq('type', 'search').not('term', 'like', `${NO_RESULTS_PREFIX}%`).gte('created_at', since).limit(1)
      if (error) throw new Error(error.message)
      return count ?? 0
    }),
  ])

  const checks: Check[] = []
  const failed: string[] = []
  const add = (label: string, ok: boolean, make: () => Check) => (ok ? checks.push(make()) : failed.push(label))

  const run = syncRow?.run ?? null
  add('Visible products', visible != null, () => visibleProductsCheck(visible!))
  add('Nightly sync', syncRow != null, () => syncCheck(run, nowMs))
  add('Low-stock email', switchOn != null, () => lowStockEmailCheck({ switchOn: switchOn!, recipientSet: isEmailConfigured(), lastResult: run?.details?.lowStock }))
  add('Prices on the storefront', display != null, () => priceDisplayCheck(display!.show_price_listing, display!.show_price_detail))
  add('Prices waiting for Erply', held != null, () => heldPricesCheck(held!))
  add('Price Review queue', pending != null, () => staleReviewCheck(pending!))

  let search: SearchSummary | null = null
  if (zero && codes && totalSearches != null) {
    const lookup: CodeLookup = { get: (c) => codes.get(c.trim().toLowerCase()) }
    search = summarizeSearches(zero, totalSearches, lookup)
    checks.push(searchCheck(search, SEARCH_DAYS))
  } else failed.push('Searches')

  checks.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  return { checks, search, failed }
}
