/**
 * Matching staged shipment SKUs against the mirrored QuickBooks item list.
 *
 * One module because the count on /admin/quickbooks/items and the write that
 * fills proposed_name have to agree — a screen that says "63 found" and a
 * button that fills 40 is worse than either number alone.
 */

import type { getAdminClient } from '@/lib/supabase'

type Db = ReturnType<typeof getAdminClient>

export interface QbDirectoryRow {
  sku: string
  full_name: string
  sales_desc: string | null
  item_type: string | null
  sales_price: number | null
  is_active: boolean | null
}

export interface SkuResolution {
  sku: string
  /** The single usable QuickBooks record, when there is exactly one. */
  match?: QbDirectoryRow
  /**
   * Why this SKU can't be filled. `missing` is the actionable one — it means
   * the product hasn't been set up in QuickBooks yet.
   */
  problem?: 'missing' | 'ambiguous' | 'no_description'
  /** Every candidate, when ambiguous, so the UI can show what to choose between. */
  candidates?: QbDirectoryRow[]
}

const COLUMNS = 'sku, full_name, sales_desc, item_type, sales_price, is_active'

/**
 * Looks SKUs up case-insensitively via the `sku_norm` generated column
 * (migration 0051).
 *
 * QuickBooks' casing does not match the supplier sheets' — "FD400004-25yard"
 * against "FD400004-25YARD" — and a case-sensitive `in` silently missed 23
 * of 63 real matches when this shipped. Chunked because `in` lists get
 * unwieldy, same as everywhere else in this codebase.
 */
export async function fetchQbItemsBySku(db: Db, skus: string[]): Promise<Map<string, QbDirectoryRow[]>> {
  const wanted = new Set(skus.map((s) => String(s).toUpperCase()))
  const list = [...wanted]
  const bySku = new Map<string, QbDirectoryRow[]>()
  const add = (row: QbDirectoryRow) => {
    const key = String(row.sku).toUpperCase()
    bySku.set(key, [...(bySku.get(key) ?? []), row])
  }

  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await db
      .from('qb_item_directory')
      .select(COLUMNS)
      .in('sku_norm', list.slice(i, i + 200))

    if (error) {
      // 42703 = column does not exist, i.e. migration 0051 hasn't been
      // applied yet. Fall back to reading the directory and matching in
      // memory rather than erroring the whole screen: the generated column
      // is an indexing improvement, not a correctness requirement, and this
      // code shipped ahead of the migration. Any other error is real.
      if (error.code !== '42703') throw new Error(`QuickBooks item lookup failed: ${error.message}`)
      return fetchByScan(db, wanted)
    }
    for (const row of (data ?? []) as QbDirectoryRow[]) add(row)
  }
  return bySku
}

/** Paged full read, matched case-insensitively in memory. See above. */
async function fetchByScan(db: Db, wanted: Set<string>): Promise<Map<string, QbDirectoryRow[]>> {
  const bySku = new Map<string, QbDirectoryRow[]>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('qb_item_directory')
      .select(COLUMNS)
      .order('qb_item_list_id')
      .range(from, from + 999)
    if (error) throw new Error(`QuickBooks item lookup failed: ${error.message}`)
    const rows = (data ?? []) as QbDirectoryRow[]
    for (const row of rows) {
      const key = String(row.sku).toUpperCase()
      if (!wanted.has(key)) continue
      bySku.set(key, [...(bySku.get(key) ?? []), row])
    }
    // A short page means the end. Without this the loop would stop at the
    // default 1000-row cap and silently miss most of the directory — the
    // same trap that produced a wrong barcode census earlier this month.
    if (rows.length < 1000) break
  }
  return bySku
}

/**
 * Decides, per SKU, whether the directory can name it.
 *
 * Ambiguity is a refusal, not a coin flip. 40 SKUs in the real pull have two
 * QuickBooks items each — a bare "B324045" and a sub-item "Backpack:B324045"
 * that reduce to the same SKU — and picking one silently would put a name on
 * a product from the wrong record. The same reasoning as the Commercial
 * Invoice joiner, which refuses a shared cartons/pieces signature rather
 * than resolve it by processing order.
 *
 * An inactive QuickBooks item is still a usable description; it only means
 * the item is discontinued there, which is worth knowing but not a reason to
 * withhold the name. Where one candidate is active and the other isn't, the
 * active one wins — that is a real disambiguation rather than a guess.
 */
export function resolveSku(sku: string, candidates: QbDirectoryRow[] | undefined): SkuResolution {
  if (!candidates || candidates.length === 0) return { sku, problem: 'missing' }

  let usable = candidates.filter((c) => c.sales_desc && String(c.sales_desc).trim())
  if (usable.length === 0) return { sku, problem: 'no_description', candidates }

  if (usable.length > 1) {
    const active = usable.filter((c) => c.is_active !== false)
    if (active.length === 1) usable = active
    else return { sku, problem: 'ambiguous', candidates: usable }
  }

  return { sku, match: usable[0] }
}

export async function resolveSkus(db: Db, skus: string[]): Promise<SkuResolution[]> {
  const bySku = await fetchQbItemsBySku(db, skus)
  return [...new Set(skus.map((s) => String(s)))].map((s) => resolveSku(s, bySku.get(s.toUpperCase())))
}
