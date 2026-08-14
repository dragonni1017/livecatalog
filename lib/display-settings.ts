import { cache } from 'react'
import { supabase } from './supabase'

export interface DisplaySettings {
  show_stock_listing: boolean
  show_stock_detail: boolean
  show_sku_barcode_listing: boolean
  show_sku_barcode_detail: boolean
  show_category_listing: boolean
  show_category_detail: boolean
  show_pack_info_listing: boolean
  show_pack_info_detail: boolean
  show_price_listing: boolean
  show_price_detail: boolean
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  show_stock_listing: true,
  show_stock_detail: true,
  show_sku_barcode_listing: true,
  show_sku_barcode_detail: true,
  show_category_listing: true,
  show_category_detail: true,
  show_pack_info_listing: true,
  show_pack_info_detail: true,
  show_price_listing: true,
  show_price_detail: true,
}

// React.cache dedupes this per request — ProductCard calls it once per card
// but a grid of 50 products still only costs one DB round trip. Falls back to
// all-on defaults if the row (or table, pre-migration) is missing so the
// storefront never breaks because of this optional table.
export const getDisplaySettings = cache(async (): Promise<DisplaySettings> => {
  const { data } = await supabase.from('display_settings').select('*').eq('id', 1).single()
  if (!data) return DEFAULT_DISPLAY_SETTINGS
  return { ...DEFAULT_DISPLAY_SETTINGS, ...data }
})
