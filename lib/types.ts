export interface Category {
  id: string
  name: string
  slug: string
  display_order: number
}

export interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  price_cents: number
  category_id: string
  category?: Category
  stock_qty: number
  is_active: boolean
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
}

// Result returned after an import run
export interface ImportResult {
  inserted: number
  updated: number
  deactivated: number
  skipped: number
  errors: { row: number; sku: string; message: string }[]
}
