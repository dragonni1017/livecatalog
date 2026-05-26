import { Category, Product } from './types'
import rawData from './products-data.json'

export const MOCK_CATEGORIES: Category[] = rawData.categories as Category[]

export const MOCK_PRODUCTS: Product[] = rawData.products as Product[]

export const MOCK_PRODUCTS_WITH_CATEGORY: Product[] = MOCK_PRODUCTS.map(p => ({
  ...p,
  category: MOCK_CATEGORIES.find(c => c.id === p.category_id),
}))

export function getStockStatus(qty: number): 'in-stock' | 'low-stock' | 'out-of-stock' {
  if (qty === 0) return 'out-of-stock'
  if (qty <= 5) return 'low-stock'
  return 'in-stock'
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
