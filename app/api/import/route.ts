import { NextRequest, NextResponse } from 'next/server'
import type { ExcelRow, ImportResult } from '@/lib/types'

const MOCK_RESPONSE: ImportResult = {
  inserted: 3,
  updated: 12,
  deactivated: 1,
  skipped: 0,
  errors: [],
}

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const rows: ExcelRow[] = body.rows ?? []

    // ── Mock mode ─────────────────────────────────────────
    if (isMockMode()) {
      return NextResponse.json(MOCK_RESPONSE)
    }

    // ── Real Supabase path ────────────────────────────────
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const errors: ImportResult['errors'] = []
    let inserted = 0
    let updated = 0

    // 1. Collect unique category names
    const categoryNames = [...new Set(
      rows.map((r) => r.Category?.toString().trim()).filter((n): n is string => Boolean(n))
    )]

    // 2. Upsert categories, build name→id map
    const categoryMap: Record<string, string> = {}
    for (const name of categoryNames) {
      const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      const { data, error } = await db
        .from('categories')
        .upsert({ name, slug }, { onConflict: 'slug' })
        .select('id, name')
        .single()

      if (error || !data) {
        // Try a plain select as fallback
        const { data: existing } = await db
          .from('categories')
          .select('id, name')
          .eq('slug', slug)
          .single()
        if (existing) categoryMap[name] = existing.id
      } else {
        categoryMap[name] = data.id
      }
    }

    // 3. Upsert each product row
    const incomingSkus: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2 // +2: row 1 is headers, array is 0-indexed

      try {
        const sku = row.SKU.toString().trim()
        const name = row.Name.toString().trim()
        const price = parseFloat(row.Price.toString())

        if (!sku || !name || isNaN(price)) {
          errors.push({ row: rowNum, sku, message: 'Invalid row data (sku/name/price)' })
          continue
        }

        incomingSkus.push(sku)

        const categoryName = row.Category?.toString().trim() ?? ''
        const categoryId = categoryMap[categoryName] ?? null

        const productData = {
          sku,
          name,
          price_cents: Math.round(price * 100),
          description: row.Description?.toString().trim() || null,
          stock_qty: parseInt(row['Stock Qty']?.toString() || '0') || 0,
          image_url: row['Image URL']?.toString().trim() || null,
          is_active: row.Active?.toString().toLowerCase() !== 'false',
          ...(categoryId ? { category_id: categoryId } : {}),
          updated_at: new Date().toISOString(),
        }

        // Check if it already exists
        const { data: existing } = await db
          .from('products')
          .select('id')
          .eq('sku', sku)
          .single()

        const { error: upsertError } = await db
          .from('products')
          .upsert(productData, { onConflict: 'sku' })

        if (upsertError) {
          errors.push({ row: rowNum, sku, message: upsertError.message })
        } else if (existing) {
          updated++
        } else {
          inserted++
        }
      } catch (err) {
        errors.push({
          row: rowNum,
          sku: row.SKU?.toString() ?? '',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    // 4. Deactivate products NOT in this upload
    let deactivated = 0
    if (incomingSkus.length > 0) {
      const { data: deactivated_rows, error: deactivateError } = await db
        .from('products')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('is_active', true)
        .not('sku', 'in', `(${incomingSkus.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')})`)
        .select('id')

      if (!deactivateError && deactivated_rows) {
        deactivated = deactivated_rows.length
      }
    }

    const result: ImportResult = {
      inserted,
      updated,
      deactivated,
      skipped: errors.length,
      errors,
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[import] Unexpected error:', err)
    return NextResponse.json(
      {
        inserted: 0,
        updated: 0,
        deactivated: 0,
        skipped: 0,
        errors: [{ row: 0, sku: '', message: 'Server error during import' }],
      } satisfies ImportResult,
      { status: 500 }
    )
  }
}
