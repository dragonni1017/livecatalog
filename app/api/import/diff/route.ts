import { NextRequest, NextResponse } from 'next/server'
import type { ExcelRow, DiffResult, ClassifiedRow } from '@/lib/types'

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

function rowMatchesDb(row: ExcelRow, db: DbProduct): boolean {
  const priceCents = Math.round(parseFloat(row.Price?.toString() ?? '0') * 100)
  const stockQty = parseInt(row['Stock Qty']?.toString() || '0') || 0
  const name = row.Name.toString().trim()
  const description = row.Description?.toString().trim() || null
  const imageUrl = row['Image URL']?.toString().trim() || null
  const isActive = row.Active?.toString().toLowerCase() !== 'false'

  return (
    db.name === name &&
    db.price_cents === priceCents &&
    db.stock_qty === stockQty &&
    db.description === description &&
    db.image_url === imageUrl &&
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

    // Fetch all products so we can detect deactivations across both active and previously inactive
    const { data: dbProducts, error } = await db
      .from('products')
      .select('sku, name, price_cents, stock_qty, description, image_url, is_active')
      .limit(50000)

    if (error) throw error

    const dbBySku = new Map<string, DbProduct>()
    for (const p of dbProducts ?? []) {
      dbBySku.set(p.sku, p)
    }

    const incomingSkus = new Set<string>()
    const classifiedRows: ClassifiedRow[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const { status: validStatus, issues } = validateRow(row)
      const sku = row.SKU?.toString().trim() ?? ''
      if (sku) incomingSkus.add(sku)

      let status: ClassifiedRow['status'] = 'new'
      if (sku && dbBySku.has(sku)) {
        status = rowMatchesDb(row, dbBySku.get(sku)!) ? 'unchanged' : 'changed'
      }

      classifiedRows.push({ rowIndex: i + 2, row, status, validStatus, issues })
    }

    // Collect active DB products not present in this upload — they will be deactivated
    const toDeactivate: { sku: string; name: string }[] = []
    for (const [sku, product] of dbBySku) {
      if (product.is_active && !incomingSkus.has(sku)) {
        toDeactivate.push({ sku, name: product.name })
      }
    }

    const result: DiffResult = {
      rows: classifiedRows,
      deactivateCount: toDeactivate.length,
      deactivateSample: toDeactivate.slice(0, 10),
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[diff] Error:', err)
    return NextResponse.json({ error: 'Failed to compute diff' }, { status: 500 })
  }
}
