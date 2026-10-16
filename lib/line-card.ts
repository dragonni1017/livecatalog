// Pure helpers for the printable line card (components/line-card/LineCard.tsx).
// Kept free of Supabase/Next imports so they're unit-testable.

export const MAX_LINE_CARD_SKUS = 300

/** "Floral Paper Burgundy - 20/pk 60bx/cs cs.60" → name + pack spec. */
export function splitPackSpec(name: string): { title: string; spec: string | null } {
  const i = name.lastIndexOf(' - ')
  if (i > 0) {
    const spec = name.slice(i + 3).trim()
    if (/\/pk|bx\/cs|\bcs\.\d/i.test(spec)) return { title: name.slice(0, i).trim(), spec }
  }
  return { title: name, spec: null }
}

/** Splits a pasted SKU list on whitespace, commas or semicolons; dedupes case-insensitively, keeps order. */
export function parseSkuList(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of raw.split(/[\s,;]+/)) {
    const sku = s.trim()
    if (sku && !seen.has(sku.toUpperCase())) {
      seen.add(sku.toUpperCase())
      out.push(sku)
    }
  }
  return out.slice(0, MAX_LINE_CARD_SKUS)
}
