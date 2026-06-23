import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BarcodeCorrection, ExcelRow, ImportResult } from '@/lib/types'
import { syncToSupabase, type SyncProduct } from '@/lib/product-sync'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, 'public', any>

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

// Best-effort audit log: every barcode/GTIN value the leading-zero recovery
// logic changed before import, so a bad correction can be traced back and
// reverted. Never throws — a logging failure (e.g. the barcode_corrections
// table not existing yet, see BARCODE-LEADING-ZERO-FIX-HANDOFF.md) must
// never fail the import itself.
async function logBarcodeCorrections(db: DB, corrections: BarcodeCorrection[]) {
  if (corrections.length === 0) return
  try {
    const { error } = await db.from('barcode_corrections').insert(
      corrections.map((c) => ({
        sku: c.sku,
        column_name: c.column,
        original_value: c.original,
        corrected_value: c.corrected,
        source: 'import',
      })),
    )
    if (error) console.error('[import] barcode_corrections insert failed:', error.message)
  } catch (err) {
    console.error('[import] barcode_corrections insert threw:', err)
  }
}

// Best-effort import-history log: one row per import run. Never throws — a
// logging failure (e.g. the import_runs table not existing yet, see
// supabase/migrations/0002_import_runs.sql) must not fail the import itself.
async function logImportRun(db: DB, rowsReceived: number, result: ImportResult) {
  try {
    const { error } = await db.from('import_runs').insert({
      source: 'excel',
      rows_received: rowsReceived,
      inserted: result.inserted,
      updated: result.updated,
      deactivated: result.deactivated,
      skipped: result.skipped,
      error_count: result.errors.length,
    })
    if (error) console.error('[import] import_runs insert failed:', error.message)
  } catch (err) {
    console.error('[import] import_runs insert threw:', err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const rows: ExcelRow[] = body.rows ?? []
    const barcodeCorrections: BarcodeCorrection[] = body.barcodeCorrections ?? []

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

    await logBarcodeCorrections(db, barcodeCorrections)

    // Merge per-row validation errors with any DB-level errors from syncToSupabase
    const merged: ImportResult = {
      ...result,
      skipped: result.skipped + errors.length,
      errors: [...errors, ...result.errors],
    }

    await logImportRun(db, rows.length, merged)

    return NextResponse.json(merged satisfies ImportResult)
  } catch (err) {
    console.error('[import] Unexpected error:', err)
    return NextResponse.json(
      { inserted: 0, updated: 0, deactivated: 0, skipped: 0, errors: [{ row: 0, sku: '', message: 'Server error during import' }] } satisfies ImportResult,
      { status: 500 },
    )
  }
}
