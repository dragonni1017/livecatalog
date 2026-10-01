import { NextRequest, NextResponse } from 'next/server'
import type { ExcelRow, DiffResult, ClassifiedRow } from '@/lib/types'
import { parseStockCell, selectAll } from '@/lib/product-sync'

interface DbProduct {
  sku: string
  name: string
  price_cents: number
  stock_qty: number
  description: string | null
  image_url: string | null
  is_active: boolean
}

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

function validateRow(row: ExcelRow): { status: ClassifiedRow['validStatus']; issues: string[] } {
  const issues: string[] = []
  let status: ClassifiedRow['validStatus'] = 'valid'

  if (!row.SKU || row.SKU.toString().trim() === '') {
    issues.push('SKU is empty')
    status = 'error'
  }
  if (!row.Name || row.Name.toString().trim() === '') {
    issues.push('Name is empty')
    status = 'error'
  }
  const price = parseFloat(row.Price?.toString() ?? '')
  if (isNaN(price)) {
    issues.push('Price is not a valid number')
    status = 'error'
  }
  if (status !== 'error') {
    if (!row.Category || row.Category.toString().trim() === '') {
      issues.push('Category is empty')
      status = 'warning'
    } else if (!row.Description || row.Description.toString().trim() === '') {
      issues.push('Description missing')
      status = 'warning'
    }
  }
  return { status, issues }
}

// Mirrors what app/api/import/route.ts will actually write to an EXISTING
// product: description and category are never touched, and a blank Image URL
// or Stock Qty cell keeps the stored value. So those can't make a row
// "changed".
function rowMatchesDb(row: ExcelRow, db: DbProduct): boolean {
  const priceCents = Math.round(parseFloat(row.Price?.toString() ?? '0') * 100)
  const stockQty = parseStockCell(row['Stock Qty'])
  const name = row.Name.toString().trim()
  const imageUrl = row['Image URL']?.toString().trim() || null
  const isActive = row.Active?.toString().toLowerCase() !== 'false'

  return (
    db.name === name &&
    db.price_cents === priceCents &&
    (stockQty === null || db.stock_qty === stockQty) &&
    (imageUrl === null || db.image_url === imageUrl) &&
    db.is_active === isActive
  )
}

export async function POST(request: NextRequest) {
  try {
    const { rows }: { rows: ExcelRow[] } = await request.json()

    if (isMockMode()) {
      const mockResult: DiffResult = {
        rows: rows.slice(0, 3).map((row, i) => ({
          rowIndex: i + 2,
          row,
          status: (['new', 'changed', 'unchanged'] as const)[i % 3],
          validStatus: 'valid',
          issues: [],
        })),
        deactivateCount: 2,
        deactivateSample: [{ sku: 'OLD-001', name: 'Old Product' }],
      }
      return NextResponse.json(mockResult)
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    // Fetch all products so we can detect deactivations across both active and
    // previously inactive.
    //
    // MUST be paged. This used to be a single select with .limit(50000), which
    // silently returned only the first 1,000 rows — PostgREST enforces its own
    // max-rows cap and a larger client-side limit cannot raise it. With 3,225
    // products that made the preview lie in two directions at once: every SKU
    // past the first page was reported as "new" (F287491, a real product, came
    // back as new), and "will be deactivated" capped at 999. The import itself
    // was always correct, since lib/product-sync.ts pages properly — only this
    // preview, the thing an admin decides on, was wrong.
    const dbProducts = await selectAll<DbProduct>((from, to) =>
      db
        .from('products')
        .select('sku, name, price_cents, stock_qty, description, image_url, is_active')
        .range(from, to),
    )

    const dbBySku = new Map<string, DbProduct>()
    for (const p of dbProducts ?? []) {
      dbBySku.set(p.sku, p)
    }

    const classifiedRows: ClassifiedRow[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const { status: validStatus, issues } = validateRow(row)
      const sku = row.SKU?.toString().trim() ?? ''

      let status: ClassifiedRow['status'] = 'new'
      if (sku && dbBySku.has(sku)) {
        status = rowMatchesDb(row, dbBySku.get(sku)!) ? 'unchanged' : 'changed'
      }

      classifiedRows.push({ rowIndex: i + 2, row, status, validStatus, issues })
    }

    // The import no longer deactivates products missing from the sheet
    // (deactivateMissing: false in app/api/import/route.ts), so there's
    // nothing to warn about. Deactivate a product with Active = false instead.
    const result: DiffResult = {
      rows: classifiedRows,
      deactivateCount: 0,
      deactivateSample: [],
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[diff] Error:', err)
    return NextResponse.json({ error: 'Failed to compute diff' }, { status: 500 })
  }
}
