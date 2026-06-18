export interface Category {
  id: string
  name: string
  slug: string
  display_order: number
}

export interface Product {
  id: string
  sku: string
  barcode: string | null
  name: string
  description: string | null
  price_cents: number
  category_id: string
  category?: Category
  stock_qty: number
  is_active: boolean
  // Admin-controlled visibility flag, independent of is_active (which the
  // Erply/Excel sync owns). A product is shown publicly only when
  // is_active === true AND manually_hidden === false.
  manually_hidden: boolean
  image_url: string | null
  created_at: string
  updated_at: string
}

// Shape of one row in the imported Excel file
export interface ExcelRow {
  SKU: string
  Name: string
  Category: string
  Price: string | number
  Description?: string
  'Stock Qty'?: string | number
  'Image URL'?: string
  Active?: string | boolean
  Barcode?: string | number
  'GTIN, UPC, EAN, or ISBN'?: string | number
}

// Result returned after an import run
export interface ImportResult {
  inserted: number
  updated: number
  deactivated: number
  skipped: number
  errors: { row: number; sku: string; message: string }[]
}

// One row classified against the current DB state
export interface ClassifiedRow {
  rowIndex: number
  row: ExcelRow
  status: 'new' | 'changed' | 'unchanged'
  validStatus: 'valid' | 'warning' | 'error'
  issues: string[]
}

// Result of the pre-import diff check
export interface DiffResult {
  rows: ClassifiedRow[]
  deactivateCount: number
  deactivateSample: { sku: string; name: string }[]
}
