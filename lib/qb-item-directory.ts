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
   * the product hasn't been set up in QuickBooks yet. `pack_mismatch` is the
   * dangerous one: a record exists but describes a different product.
   */
  problem?: 'missing' | 'ambiguous' | 'no_description' | 'pack_mismatch'
  /** Every candidate, when ambiguous or conflicting, for the UI to show. */
  candidates?: QbDirectoryRow[]
  /** How the match was made, for display — never hidden from the admin. */
  basis?: 'exact' | 'exact+pack' | 'variant+pack'
}

/**
 * Pulls the case pack out of a QuickBooks description: "… - 24/cs - …",
 * "120 pcs/cs", "-24pcs/cs".
 *
 * This is the one field that can independently confirm a SKU match. The
 * packing list gives pieces and cartons, so pieces-per-case is known for
 * free, and a description quoting a different pack is describing a
 * different product.
 */
export function parsePackSize(desc: string | null | undefined): number | null {
  const m = String(desc ?? '').match(/(\d+)\s*(?:pcs?|pc)?\s*\/\s*cs/i)
  return m ? Number(m[1]) : null
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
export function resolveSku(
  sku: string,
  candidates: QbDirectoryRow[] | undefined,
  /** Pieces per case from the packing list, when the sheet gave cartons. */
  expectedPackSize?: number | null,
  /** QuickBooks items whose SKU starts with this one, e.g. "F287760- FLOWER". */
  variants: QbDirectoryRow[] = [],
): SkuResolution {
  const described = (rows: QbDirectoryRow[]) => rows.filter((c) => c.sales_desc && String(c.sales_desc).trim())
  const packMatches = (rows: QbDirectoryRow[]) =>
    expectedPackSize == null ? [] : rows.filter((c) => parsePackSize(c.sales_desc) === expectedPackSize)

  if (!candidates || candidates.length === 0) {
    // No exact record. A suffixed variant agreeing on pack size is a match
    // on two independent keys, which is stronger evidence than the
    // exact-SKU-only matches already trusted — QuickBooks holds
    // "F287760- FLOWER" (120/cs) where the container ships a bare F287760
    // at 120/cs. Only when exactly one variant agrees; otherwise it's a
    // human's call.
    const byPack = packMatches(described(variants))
    if (byPack.length === 1) return { sku, match: byPack[0], basis: 'variant+pack', candidates: variants }
    if (variants.length > 0) return { sku, problem: 'ambiguous', candidates: variants }
    return { sku, problem: 'missing' }
  }

  let usable = described(candidates)
  if (usable.length === 0) return { sku, problem: 'no_description', candidates }

  if (usable.length > 1) {
    const byPack = packMatches(usable)
    if (byPack.length === 1) return { sku, match: byPack[0], basis: 'exact+pack', candidates: usable }
    const active = usable.filter((c) => c.is_active !== false)
    if (active.length === 1) usable = active
    else return { sku, problem: 'ambiguous', candidates: usable }
  }

  // One exact record — but if it quotes a different case pack than the
  // container ships, it is describing a different product. QuickBooks'
  // bare F287759 is "White Heart Triple Set Fuzzy-24pcs/cs" while the
  // container ships 1,800 in 15 cartons (120/cs), and F287759-FLOWER is the
  // 120/cs one. Refuse rather than write a confidently wrong name; hand
  // back the better candidate so the screen can offer it.
  const qbPack = parsePackSize(usable[0].sales_desc)
  if (expectedPackSize != null && qbPack != null && qbPack !== expectedPackSize) {
    const better = packMatches(described(variants))
    return { sku, problem: 'pack_mismatch', candidates: [...usable, ...better] }
  }

  return { sku, match: usable[0], basis: qbPack != null && expectedPackSize != null ? 'exact+pack' : 'exact' }
}

export interface SkuToResolve {
  sku: string
  piecesPerCase?: number | null
}

export async function resolveSkus(db: Db, inputs: Array<string | SkuToResolve>): Promise<SkuResolution[]> {
  const normalised: SkuToResolve[] = inputs.map((i) => (typeof i === 'string' ? { sku: i } : i))
  const bySku = await fetchQbItemsBySku(db, normalised.map((i) => i.sku))

  const out: SkuResolution[] = []
  for (const { sku, piecesPerCase } of normalised) {
    const exact = bySku.get(sku.toUpperCase())
    // Only reach for variants when the exact answer is absent or suspect —
    // one extra query for a handful of SKUs rather than a prefix scan for
    // every one.
    const packConflicts =
      exact?.length === 1 &&
      piecesPerCase != null &&
      parsePackSize(exact[0].sales_desc) != null &&
      parsePackSize(exact[0].sales_desc) !== piecesPerCase
    const variants = !exact || exact.length === 0 || packConflicts ? await fetchVariants(db, sku) : []
    out.push(resolveSku(sku, exact, piecesPerCase, variants))
  }
  return out
}

/** LIKE metacharacters, so a SKU can't act as a wildcard in the prefix query. */
const escapeLike = (s: string) => s.replace(/([\\%_])/g, '\\$1')

/**
 * QuickBooks items whose SKU starts with this one — the suffixed-variant
 * case ("F287760" -> "F287760- Pk", "F287760- FLOWER"). Uses ilike on `sku`
 * rather than sku_norm so it works without migration 0051.
 */
async function fetchVariants(db: Db, sku: string): Promise<QbDirectoryRow[]> {
  const { data, error } = await db
    .from('qb_item_directory')
    .select(COLUMNS)
    .ilike('sku', `${escapeLike(sku)}%`)
  if (error) throw new Error(`QuickBooks variant lookup failed: ${error.message}`)
  return ((data ?? []) as QbDirectoryRow[]).filter((r) => String(r.sku).toUpperCase() !== sku.toUpperCase())
}
