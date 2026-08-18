/**
 * Shared product sync utilities — used by both:
 *   /api/import  (manual Excel upload)
 *   /api/sync    (automated Erply cron)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImportResult } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, 'public', any>

const CHUNK_SIZE = 500
const PAGE_SIZE = 1000

/**
 * Fetch every row from a select, paginating past Supabase/PostgREST's default
 * 1000-row response cap. `makeQuery` must return a fresh range-limited query
 * each call (a query builder is single-use).
 */
async function selectAll<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await makeQuery(from, from + PAGE_SIZE - 1)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return all
}

/** Normalized product shape that both sources (Excel + Erply) map into */
export interface SyncProduct {
  sku: string
  barcode: string | null
  name: string
  price_cents: number
  description: string | null
  stock_qty: number
  image_url: string | null
  is_active: boolean
  category_name: string
}

/**
 * Upsert category names and return a map of { name → id }.
 * Inserts new categories; returns existing ids for known ones.
 */
export async function resolveCategories(
  categoryNames: string[],
  db: DB,
): Promise<Record<string, string>> {
  const unique = [...new Set(categoryNames.filter(Boolean))]
  const map: Record<string, string> = {}

  // Look up by NAME first, not just slug. Several categories' stored slug
  // is a leftover from before a rename (e.g. "Toys & Novelties" is stored
  // with slug "plush-toys", from before the Plush category was split out)
  // and no longer matches what this function's own slugification would
  // generate from the current name -- matching by slug alone in that case
  // finds no conflict and silently inserts a duplicate row with the same
  // display name but a different id/slug.
  const { data: existingByName } = await db.from('categories').select('id, name').in('name', unique)
  const idByName = new Map((existingByName ?? []).map((c) => [c.name, c.id]))

  for (const name of unique) {
    const existingId = idByName.get(name)
    if (existingId) {
      map[name] = existingId
      continue
    }

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const { data, error } = await db
      .from('categories')
      .upsert({ name, slug }, { onConflict: 'slug' })
      .select('id')
      .single()

    if (error || !data) {
      const { data: existing } = await db.from('categories').select('id').eq('slug', slug).single()
      if (existing) map[name] = existing.id
    } else {
      map[name] = data.id
    }
  }

  return map
}

export interface SyncPreview {
  incoming: number
  wouldInsert: number
  wouldUpdate: number
  wouldDeactivate: number
  deactivateSample: { sku: string; name: string }[]
  newCategories: string[]
}

/**
 * Read-only dry run of syncToSupabase: reports what a real sync of `products`
 * WOULD change without writing anything. Use this to validate an Erply sync
 * before letting it run — a large wouldDeactivate means the incoming SKUs don't
 * line up with the catalog and a real sync would wipe it.
 */
export async function previewSync(products: SyncProduct[], db: DB): Promise<SyncPreview> {
  const incomingSkus = products.map((p) => p.sku)
  const incomingSet = new Set(incomingSkus)

  const existingRows = await selectAll<{ sku: string }>((from, to) =>
    db.from('products').select('sku').range(from, to),
  )
  const existingSkus = new Set(existingRows.map((r) => r.sku))

  const wouldInsert = incomingSkus.filter((s) => !existingSkus.has(s)).length
  const wouldUpdate = incomingSkus.filter((s) => existingSkus.has(s)).length

  // Currently-active products whose SKU isn't in the incoming batch → would be deactivated.
  const activeRows = await selectAll<{ sku: string; name: string }>((from, to) =>
    db.from('products').select('sku, name').eq('is_active', true).range(from, to),
  )
  const toDeactivate = activeRows.filter((r) => !incomingSet.has(r.sku))

  // Category names not already present (by slug).
  const { data: catRows } = await db.from('categories').select('slug')
  const existingSlugs = new Set((catRows ?? []).map((c) => c.slug))
  const incomingCats = [...new Set(products.map((p) => p.category_name).filter(Boolean))]
  const newCategories = incomingCats.filter((name) => {
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    return !existingSlugs.has(slug)
  })

  return {
    incoming: products.length,
    wouldInsert,
    wouldUpdate,
    wouldDeactivate: toDeactivate.length,
    deactivateSample: toDeactivate.slice(0, 20).map((r) => ({ sku: r.sku, name: r.name })),
    newCategories,
  }
}

export interface SyncOptions {
  /**
   * Fields to leave out of the upsert payload entirely (existing DB value is
   * preserved) rather than overwritten with the incoming value. Use this for
   * sources whose data for that field isn't trustworthy yet — e.g. Erply's
   * image_url/stock_qty (see docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md) —
   * without affecting other sources (Excel import legitimately sets both).
   *
   * 'category' is different from the other two: it's not that the incoming
   * value is untrustworthy, it's that several Supabase categories are
   * deliberate manual carve-outs from a broader source group with no clean
   * 1:1 mapping (see lib/erply-category-aliases.ts) — reassigning category
   * on every sync run would silently flatten that curation back on a
   * schedule. Skipping it means category_id is only ever set when a
   * product is first inserted, never overwritten on update.
   */
  skipFields?: Array<'image_url' | 'stock_qty' | 'category'>
}

/**
 * Bulk-upsert products into Supabase and deactivate any that are no longer
 * in the incoming list.  Returns insert / update / deactivate counts.
 */
export async function syncToSupabase(
  products: SyncProduct[],
  db: DB,
  options: SyncOptions = {},
): Promise<ImportResult> {
  const errors: ImportResult['errors'] = []
  const skip = new Set(options.skipFields ?? [])

  // 1. Resolve categories
  const categoryNames = products.map((p) => p.category_name)
  const categoryMap = await resolveCategories(categoryNames, db)

  // 2. Snapshot existing SKUs for insert vs update counting.
  //    Paginate: a plain select is capped at 1000 rows by PostgREST, which would
  //    misclassify updates as inserts once the catalog exceeds 1000 products.
  const existingRows = await selectAll<{ sku: string }>((from, to) =>
    db.from('products').select('sku').range(from, to),
  )
  const existingSkus = new Set(existingRows.map((r) => r.sku))

  // 3. Build DB records
  const now = new Date().toISOString()
  const incomingSkus: string[] = []
  const records: Record<string, unknown>[] = []

  for (const p of products) {
    incomingSkus.push(p.sku)
    // When 'category' is skipped, only set category_id for products that
    // don't exist yet (a real insert) -- an existing product's category
    // is left alone rather than reassigned on every sync run.
    const setCategory = !skip.has('category') || !existingSkus.has(p.sku)
    const categoryId = setCategory ? categoryMap[p.category_name] ?? null : null
    records.push({
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      price_cents: p.price_cents,
      description: p.description,
      is_active: p.is_active,
      ...(skip.has('stock_qty') ? {} : { stock_qty: p.stock_qty }),
      ...(skip.has('image_url') ? {} : { image_url: p.image_url }),
      ...(categoryId ? { category_id: categoryId } : {}),
      updated_at: now,
    })
  }

  // 4. Bulk upsert in chunks
  const failedSkus = new Set<string>()
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE)
    const { error } = await db.from('products').upsert(chunk, { onConflict: 'sku' })
    if (error) {
      chunk.forEach((r) => {
        const sku = r.sku as string
        failedSkus.add(sku)
        errors.push({ row: 0, sku, message: error.message })
      })
    }
  }

  // 5. Count inserted vs updated (excluding failures)
  const successSkus = incomingSkus.filter((s) => !failedSkus.has(s))
  const inserted = successSkus.filter((s) => !existingSkus.has(s)).length
  const updated  = successSkus.filter((s) =>  existingSkus.has(s)).length

  // 6. Deactivate products not in this batch
  let deactivated = 0
  if (incomingSkus.length > 0) {
    const skuList = incomingSkus.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')
    const { data: deactivatedRows, error } = await db
      .from('products')
      .update({ is_active: false, updated_at: now })
      .eq('is_active', true)
      .not('sku', 'in', `(${skuList})`)
      .select('id')

    if (!error && deactivatedRows) deactivated = deactivatedRows.length
  }

  // 7. Low-stock reorder alerts — never let a notification failure fail the sync.
  try {
    const { checkLowStockAndNotify } = await import('./low-stock-alert')
    await checkLowStockAndNotify(db)
  } catch (err) {
    console.error('[low-stock] notify failed (non-fatal):', err)
  }

  // 8. Back-in-stock notifications — same non-fatal guard.
  try {
    const { checkBackInStockAndNotify } = await import('./back-in-stock-notify')
    await checkBackInStockAndNotify(db)
  } catch (err) {
    console.error('[back-in-stock] notify failed (non-fatal):', err)
  }

  return { inserted, updated, deactivated, skipped: errors.length, errors }
}
