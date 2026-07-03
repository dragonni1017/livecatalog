import { getAdminClient } from '@/lib/supabase'

interface AuditEntry {
  action: string
  entity_type: string
  entity_id?: string
  entity_label?: string
  old_value?: string
  new_value?: string
  performed_by?: string
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const db = getAdminClient()
    await db.from('audit_log').insert({
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      entity_label: entry.entity_label ?? null,
      old_value: entry.old_value ?? null,
      new_value: entry.new_value ?? null,
      performed_by: entry.performed_by ?? 'admin',
    })
  } catch {
    // best-effort — never block the main action
  }
}
