// Admin switches for the app's alert emails (alert_settings, migration 0077).
// A missing row or table (pre-migration) or a failed read means "on": the
// switch only ever turns an email off on purpose.
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, 'public', any>

export async function isLowStockEmailEnabled(db: DB): Promise<boolean> {
  const { data, error } = await db.from('alert_settings').select('low_stock_email_enabled').eq('id', 1).maybeSingle()
  if (error) console.error('[alert-settings] read failed, treating low-stock email as on:', error.message)
  return data?.low_stock_email_enabled !== false
}

export async function setLowStockEmailEnabled(db: DB, enabled: boolean): Promise<void> {
  const { error } = await db
    .from('alert_settings')
    .upsert({ id: 1, low_stock_email_enabled: enabled, updated_at: new Date().toISOString() })
  if (error) throw error
}
