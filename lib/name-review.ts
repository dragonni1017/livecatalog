// Name review decisions (migration 0071, /admin/name-review). Pure.
//
// Approving a row renames the product through lib/product-name-fix.ts
// (Erply first, then WooCommerce, then the catalog, each guarded on the
// expected old name). These helpers decide whether that run counts as done.

import type { NameChangeRow } from '@/lib/product-name-fix'

export type NameReviewAction = 'approve' | 'skip' | 'reopen'

export interface NameReviewRequest {
  id: string
  action: NameReviewAction
  /** Approve only: the new name. */
  name?: string
}

export const MAX_NAME_LENGTH = 200

export function parseNameReviewBody(body: unknown): NameReviewRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request' }
  const b = body as Record<string, unknown>
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  if (!id) return { error: 'Missing id' }
  if (b.action !== 'approve' && b.action !== 'skip' && b.action !== 'reopen') {
    return { error: 'Action must be approve, skip or reopen' }
  }
  if (b.action !== 'approve') return { id, action: b.action }
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : ''
  if (!name) return { error: 'Enter the new name.' }
  if (name.length > MAX_NAME_LENGTH) return { error: `Keep the name under ${MAX_NAME_LENGTH} characters.` }
  return { id, action: 'approve', name }
}

const OK = new Set(['updated + verified', 'already correct'])

/**
 * Done when nothing failed, no system had a different name than expected,
 * and the catalog now shows the new name. A system that simply doesn't have
 * the SKU, or WooCommerce not being configured here, doesn't block it.
 */
export function renameSucceeded(rows: NameChangeRow[]): boolean {
  const blocking = rows.some(
    (r) => r.status.startsWith('FAILED') || r.status.startsWith('SKIPPED — name differs') || r.status.startsWith('SKIPPED — an earlier'),
  )
  const catalog = rows.find((r) => r.system === 'supabase')
  return !blocking && !!catalog && OK.has(catalog.status)
}

/** One line for the screen and the audit log: "erply: updated + verified; …". */
export function summarizeRename(rows: NameChangeRow[]): string {
  return rows.map((r) => `${r.system}: ${r.status}`).join('; ')
}
