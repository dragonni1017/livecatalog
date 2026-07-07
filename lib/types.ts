export interface Category {
  id: string
  name: string
  slug: string
  display_order: number
}

export interface VolumeTier {
  min_qty: number
  price_cents: number
}

export type UnitType = 'pc' | 'case' | 'box' | 'pack'

export interface Product {
  id: string
  sku: string
  barcode: string | null
  name: string
  description: string | null
  price_cents: number
  // What price_cents is quoted per. Admin-facing only — never shown to
  // customers on the storefront, so public catalog queries don't select it.
  unit_type?: UnitType
  category_id: string
  category?: Category
  stock_qty: number
  is_active: boolean
  // Admin-controlled visibility flag, independent of is_active (which the
  // Erply/Excel sync owns). A product is shown publicly only when
  // is_active === true AND manually_hidden === false.
  manually_hidden: boolean
  image_url: string | null
  image_urls: string[]
  volume_tiers: VolumeTier[] | null
  created_at: string
  updated_at: string
}

// ── Manual stock adjustments (see STAFF-LOGIN-AND-STOCK-ADJUSTMENTS-HANDOFF.md) ──

export interface StockAdjustment {
  id: string
  delta: number
  previous_qty: number
  new_qty: number
  reason: string | null
  changed_by_email: string
  created_at: string
}

// ── Cart + Sales Order Request (see docs/CART-AND-SALES-ORDER-PLAN.md) ───────────

export type OrderStatus = 'new' | 'contacted' | 'converted' | 'lost'

// One line in the client-side cart. Prices are a snapshot taken at add time;
// the server re-validates the real price on submit (never trust the client).
export interface CartItem {
  productId: string
  sku: string
  name: string
  priceCents: number
  qty: number
  imageUrl: string | null
}

// Contact details collected on the checkout form. No payment fields.
export interface CheckoutContact {
  name: string
  email: string
  phone?: string
  company?: string
  notes?: string
  // Which sales rep placed the order (free text or from a ?rep= link).
  placedByRep?: string
  // Customer's own purchase-order reference.
  poNumber?: string
  // Optional sales-rep email to CC on the order notification.
  ccEmail?: string
}

export interface OrderRequest {
  id: string
  reference_code: string
  status: OrderStatus
  customer_name: string
  customer_email: string
  customer_phone: string | null
  customer_company: string | null
  notes: string | null
  subtotal_cents: number
  placed_by_rep: string | null
  po_number: string | null
  assigned_rep_email: string | null
  status_changed_by: string | null
  status_changed_at: string | null
  // True once a worker has keyed this order into QuickBooks Desktop. Orthogonal
  // to status — see migration 0005_entered_in_qb.sql.
  entered_in_qb: boolean
  entered_in_qb_at: string | null
  created_at: string
  updated_at: string
}

export interface OrderItemRecord {
  id: string
  order_id: string
  product_id: string | null
  sku: string
  name: string
  unit_price_cents: number
  qty: number
  line_total_cents: number
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

// One value the leading-zero recovery logic changed before it was sent to
// the server, kept so a bad/unexpected correction can be traced back and
// reverted later. See docs/BARCODE-LEADING-ZERO-FIX-HANDOFF.md.
export interface BarcodeCorrection {
  sku: string
  column: string
  original: string
  corrected: string
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
