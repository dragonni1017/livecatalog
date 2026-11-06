// WooCommerce export (/admin/woo-export): the catalog's "ready" products as a
// CSV in WooCommerce's own product-import format, plus an "almost ready" list
// of what each other product is missing. Pure.
//
// Import with Products -> Import -> "Update existing products": WooCommerce
// matches rows by SKU and leaves columns that aren't in the file alone.
// Name, price and stock are deliberately NOT exported: Erply's WooCommerce
// Integration pushes those, and anything different would be overwritten on
// its next run (and the catalog's held prices aren't in Erply yet).

import { isNameCopyDescription } from './product-description.ts'

export interface ExportProduct {
  id: string
  sku: string | null
  name: string
  description: string | null
  image_url: string | null
  image_urls: string[] | null
  needs_photo: boolean | null
  price_cents: number | null
  stock_qty: number | null
  is_active: boolean
  manually_hidden: boolean
  category_id: string | null
}

export type Missing = 'photo' | 'price' | 'category' | 'description' | 'hidden on purpose'

export interface ExportOptions {
  images: boolean
  categories: boolean
}

/** What keeps an active product out of the ready set; empty = ready. */
export function missingFor(p: ExportProduct, categoryName: string | null): Missing[] {
  const out: Missing[] = []
  if (!(p.image_url ?? '').trim() || p.needs_photo) out.push('photo')
  if (!((p.price_cents ?? 0) > 0)) out.push('price')
  if (!categoryName) out.push('category')
  if (!(p.description ?? '').trim() || isNameCopyDescription(p.description, p.name)) out.push('description')
  if (p.manually_hidden) out.push('hidden on purpose')
  return out
}

/** First sentence, for WooCommerce's short description (shown beside the price). */
export function shortDescription(desc: string): string {
  const t = desc.replace(/\s+/g, ' ').trim()
  const m = /^(.{20,200}?[.!?])(\s|$)/.exec(t)
  if (m) return m[1]
  return t.length <= 200 ? t : `${t.slice(0, 197).replace(/\s+\S*$/, '')}…`
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const asHtml = (s: string) => s.trim().split(/\n+/).map((l) => `<p>${escapeHtml(l.trim())}</p>`).join('\n')

/** WooCommerce's own import column names, so the importer maps them automatically. */
export function wooHeader(o: ExportOptions): string[] {
  return ['SKU', 'Published', 'Visibility in catalog', 'Short description', 'Description', ...(o.categories ? ['Categories'] : []), ...(o.images ? ['Images'] : [])]
}

export function wooRow(p: ExportProduct, categoryName: string | null, o: ExportOptions): string[] {
  const desc = p.description ?? ''
  const images = (p.image_urls?.length ? p.image_urls : [p.image_url]).filter((u): u is string => !!u && !!u.trim())
  return [
    (p.sku ?? '').trim(),
    '1',
    'visible',
    shortDescription(desc),
    asHtml(desc),
    // A comma inside a WooCommerce category name must be escaped with a backslash.
    ...(o.categories ? [(categoryName ?? '').replace(/,/g, '\\,')] : []),
    ...(o.images ? [images.join(', ')] : []),
  ]
}

export interface ExportResult {
  ready: string[][]
  almost: { sku: string; name: string; missing: Missing[]; stock: number }[]
}

export function buildExport(products: ExportProduct[], categoryOf: (p: ExportProduct) => string | null, o: ExportOptions): ExportResult {
  const ready: string[][] = []
  const almost: ExportResult['almost'] = []
  for (const p of products) {
    if (!p.is_active || !(p.sku ?? '').trim()) continue
    const cat = categoryOf(p)
    const missing = missingFor(p, cat)
    if (missing.length === 0) ready.push(wooRow(p, cat, o))
    else almost.push({ sku: p.sku!.trim(), name: p.name, missing, stock: p.stock_qty ?? 0 })
  }
  ready.sort((a, b) => a[0].localeCompare(b[0]))
  // Closest to ready first (fewest things missing), then most stock.
  almost.sort((a, b) => a.missing.length - b.missing.length || b.stock - a.stock || a.sku.localeCompare(b.sku))
  return { ready, almost }
}

const cell = (v: string | number) => {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
/** CSV with a UTF-8 BOM so Excel keeps inch marks and accents intact. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
