/**
 * Whether a product's description says anything beyond its name.
 *
 * Erply has no description field of its own worth the name, so on creation
 * the sync stored a copy of the Erply name plus "/cs" ("Heart Bear 12\" -
 * 12/pk 4bx/cs cs.48/cs"). On 2026-10-26 every non-blank description on an
 * active product was one of these. Descriptions are catalog-owned (the sync
 * never updates them), so after a rename the copy goes stale: 42 still carried
 * an old name, some with a different pack spec than the current name (gift
 * bows: "100/pk 20bx/cs" against "20/pk 100bx/cs") and two naming a different
 * product. Showing them repeats the name at best and contradicts it at worst.
 *
 * Pure, so the product page, its structured data and /admin/cleanup agree.
 */

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))

/** "... - 12/pk 4bx/cs cs.48/cs": the tail of the sync's name copy. */
const NAME_COPY_TAIL = /\d+\s*\/\s*pk\s+\d+\s*bx\s*\/\s*cs\s+cs\.\S*\/cs\s*$/i

export function isNameCopyDescription(description: string | null | undefined, name: string | null | undefined): boolean {
  const d = (description ?? '').trim()
  if (!d) return false
  if (NAME_COPY_TAIL.test(d)) return true
  const nameWords = words(name ?? '')
  for (const w of words(d)) if (w !== 'cs' && !nameWords.has(w)) return false
  return true
}

/**
 * The description to show customers, or '' when there isn't a real one
 * (blank, or a copy of the current or an earlier name).
 */
export function meaningfulDescription(description: string | null | undefined, name: string | null | undefined): string {
  const d = (description ?? '').trim()
  return d && !isNameCopyDescription(d, name) ? d : ''
}
