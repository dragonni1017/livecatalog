/**
 * Pull the wholesale pack/quantity spec out of a product name.
 *
 * Product names carry the pack breakdown as a suffix, e.g.
 *   "Large 3D Printed Lobster - 12/pk 12bx/cs cs.144"
 *   "1.5M 3D Chinese Dragon - 1/pk 1bx/cs"
 * This extracts just the "12/pk 12bx/cs cs.144" portion so it can be shown as
 * the product's pack quantities. Returns null if the name has no such spec.
 */
export function extractPackSpec(name: string | null | undefined): string | null {
  if (!name) return null
  const m = name.match(/\d+\s*\/\s*pk\b[^]*?\d+\s*bx\s*\/\s*cs(?:\s*cs\.\d+)?/i)
  return m ? m[0].replace(/\s+/g, ' ').trim() : null
}

/**
 * How many individual units make up one case, read off the pack spec (e.g.
 * "cs.144" or "12bx/cs" with no explicit cs. count). Returns 0 when the name
 * has no parseable pack spec — callers should treat that as "unknown."
 */
export function extractUnitsPerCase(name: string | null | undefined): number {
  const spec = extractPackSpec(name)
  if (!spec) return 0
  return Number(spec.match(/cs\.(\d+)/i)?.[1] ?? spec.match(/(\d+)\s*bx\s*\/\s*cs/i)?.[1] ?? 0)
}
