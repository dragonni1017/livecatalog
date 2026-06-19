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

  for (const name of unique) {
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

/**
 * Bulk-upsert products into Supabase and deactivate any that are no longer
 * in the incoming list.  Returns insert / update / deactivate counts.
 */
export async function syncToSupabase(products: SyncProduct[], db: DB): Promise<ImportResult> {
  const errors: ImportResult['errors'] = []

  // 1. Resolve categories
  const categoryNames = products.map((p) => p.category_name)
  const categoryMap = await resolveCategories(categoryNames, db)

  // 2. Snapshot existing SKUs for insert vs update counting
  const { data: existingRows } = await db.from('products').select('sku').limit(100000)
  const existingSkus = new Set(existingRows?.map((r) => r.sku) ?? [])

  // 3. Build DB records
  const now = new Date().toISOString()
  const incomingSkus: string[] = []
  const records: Record<string, unknown>[] = []

  for (const p of products) {
    incomingSkus.push(p.sku)
    const categoryId = categoryMap[p.category_name] ?? null
    records.push({
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      price_cents: p.price_cents,
      description: p.description,
      stock_qty: p.stock_qty,
      image_url: p.image_url,
      is_active: p.is_active,
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

  return { inserted, updated, deactivated, skipped: errors.length, errors }
}
