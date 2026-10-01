/**
 * What /admin/cleanup considers "needs attention" about a product.
 *
 * Pure and dependency-light so the page, the API routes and any future
 * script classify a row identically.
 */

import { auditProductName, parseProductName, type NameIssue, type PackSpec } from './product-naming.ts'

export type CleanupIssue = 'photo' | 'name' | 'category' | 'description'

export const CLEANUP_ISSUES: CleanupIssue[] = ['photo', 'name', 'category', 'description']

export interface CleanupClassifiable {
  name: string
  image_url: string | null
  needs_photo: boolean | null
  category_id: string | null
  description: string | null
  /** True when the product has at least one product_categories row (migration 0038). */
  has_category_link: boolean
}

export type CleanupFlags = Record<CleanupIssue, boolean>

/**
 * - photo:       no image_url, or flagged needs_photo (receiving sets it on
 *                products created without one)
 * - name:        auditProductName reports any issue
 * - category:    no category_id AND no product_categories row. Either one is
 *                enough to place the product: 666 live rows had a join row
 *                but a null category_id on 2026-10-01, and they do show in
 *                their category.
 * - description: blank after trimming
 */
export function classifyProduct(row: CleanupClassifiable): CleanupFlags {
  return {
    photo: !(row.image_url ?? '').trim() || row.needs_photo === true,
    name: auditProductName(row.name).issues.length > 0,
    category: !row.category_id && !row.has_category_link,
    description: !(row.description ?? '').trim(),
  }
}

export function cleanupIssues(row: CleanupClassifiable): CleanupIssue[] {
  const flags = classifyProduct(row)
  return CLEANUP_ISSUES.filter((i) => flags[i])
}

/** Two parsed specs say the same thing: all three numbers AND the stated unit. */
export function samePackSpec(a: PackSpec | null, b: PackSpec | null): boolean {
  if (!a || !b) return a === b
  return (
    a.piecesPerPack === b.piecesPerPack &&
    a.boxesPerCase === b.boxesPerCase &&
    a.piecesPerCase === b.piecesPerCase &&
    a.caseUnit === b.caseUnit
  )
}

/**
 * Does renaming `from` -> `to` leave the pack spec exactly as it was?
 *
 * The cleanup screen may only make cosmetic name fixes. A pack-spec change
 * (adding one, removing one, or altering any number or unit) is a business
 * decision that goes through scripts/fix-product-names.ts with its reason
 * written down, never through a text box.
 */
export function keepsPackSpec(from: string, to: string): boolean {
  return samePackSpec(parseProductName(from).spec, parseProductName(to).spec)
}

// ── Photos ────────────────────────────────────────────────────────────────────
//
// Public ids follow the receiving convention (app/admin/api/shipments/photos):
// the primary photo is the bare SKU, each extra view is `${SKU}-${n}` with n
// taken from the file name, no folder. A re-upload therefore overwrites the
// same asset rather than accumulating copies.

/** The SKUs a public id could belong to: itself, and its base if it ends in -n. */
export function skuCandidatesForPublicId(publicId: string): string[] {
  const m = /^(.+)-(\d+)$/.exec(publicId)
  return m ? [publicId, m[1]] : [publicId]
}

/**
 * The public id inside a stored Cloudinary URL, or null when the URL is not a
 * RAW original on this cloud.
 *
 * Raw means `.../image/upload/[v<version>/]<public_id>.<ext>` and nothing
 * else: a transformation segment (f_auto, w_800 ...) between `upload/` and the
 * id would be baked into products.image_url forever, which breaks the
 * render-time sizing contract in lib/image.ts
 * (docs/memory/project-image-sizing-contract.md).
 */
export function rawCloudinaryPublicId(url: string, cloudName: string): string | null {
  const prefix = `https://res.cloudinary.com/${cloudName}/image/upload/`
  if (!url.startsWith(prefix)) return null
  const rest = url.slice(prefix.length)
  const m = /^(?:v\d+\/)?([^/?#]+)\.[a-z0-9]+$/i.exec(rest)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return null
  }
}

export interface CleanupNameAudit {
  issues: NameIssue[]
  /**
   * auditProductName's suggestion, but ONLY when it keeps the pack spec's
   * numbers and unit exactly. Its rebuild writes `cs.N` without the unit, so
   * on a name like "... cs.25pk" with a cosmetic issue it would silently
   * turn an unambiguous pack-sold spec into an ambiguous one. Such a
   * suggestion is withheld rather than offered.
   */
  suggestion: string | null
}

export function cleanupNameAudit(name: string): CleanupNameAudit {
  const audit = auditProductName(name)
  const suggestion = audit.suggestion && keepsPackSpec(name, audit.suggestion) ? audit.suggestion : null
  return { issues: audit.issues, suggestion }
}
