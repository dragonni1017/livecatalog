import { NextRequest, NextResponse } from 'next/server'
import type { ExcelRow, ImportResult } from '@/lib/types'
import { syncToSupabase, type SyncProduct } from '@/lib/product-sync'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const rows: ExcelRow[] = body.rows ?? []

    if (isMockMode()) {
      return NextResponse.json(
        { inserted: 3, updated: 12, deactivated: 1, skipped: 0, errors: [] } satisfies ImportResult,
      )
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const validProducts: SyncProduct[] = []
    const errors: ImportResult['errors'] = []

    // Validate and map each Excel row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2  // row 1 = header, array is 0-indexed

      try {
        const sku = row.SKU?.toString().trim()
        const name = row.Name?.toString().trim()
        const price = parseFloat(row.Price?.toString() ?? '')

        if (!sku || !name || isNaN(price)) {
          errors.push({ row: rowNum, sku: sku ?? '', message: 'Missing or invalid SKU / Name / Price' })
          continue
        }

        validProducts.push({
          sku,
          barcode: row.Barcode?.toString().trim() || row['GTIN, UPC, EAN, or ISBN']?.toString().trim() || null,
          name,
          price_cents: Math.round(price * 100),
          description: row.Description?.toString().trim() || null,
          stock_qty: parseInt(row['Stock Qty']?.toString() || '0') || 0,
          image_url: row['Image URL']?.toString().trim() || null,
          is_active: row.Active?.toString().toLowerCase() !== 'false',
          category_name: row.Category?.toString().trim() ?? '',
        })
      } catch (err) {
        errors.push({
          row: rowNum,
          sku: row.SKU?.toString() ?? '',
          message: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    const result = await syncToSupabase(validProducts, db)

    // Merge per-row validation errors with any DB-level errors from syncToSupabase
    return NextResponse.json({
      ...result,
      skipped: result.skipped + errors.length,
      errors: [...errors, ...result.errors],
    } satisfies ImportResult)
  } catch (err) {
    console.error('[import] Unexpected error:', err)
    return NextResponse.json(
      { inserted: 0, updated: 0, deactivated: 0, skipped: 0, errors: [{ row: 0, sku: '', message: 'Server error during import' }] } satisfies ImportResult,
      { status: 500 },
    )
  }
}
