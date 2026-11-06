// "More in this category" on the product page. Pure.
//
// It used to show the first 6 of the category alphabetically, so every Plush
// page showed the same six (4 of them out of stock, 2026-11-06). Now:
// similar names first (shared words in the description part of the name),
// then in stock, then with a photo; ties are broken by a hash of the two
// ids, so different products show different picks but a page is stable.

import { parseProductName } from './product-naming.ts'

export interface RelatedCandidate {
  id: string
  name: string
  stock_qty: number | null
  image_url: string | null
}

// Words too common in names to say two products are alike.
const STOP = new Set([
  'with', 'and', 'the', 'for', 'set', 'pcs', 'pack', 'assorted', 'color', 'colors', 'colour', 'mixed', 'mix', 'new',
  'small', 'medium', 'large', 'mini', 'big', 'jumbo', 'inch', 'style', 'design', 'piece', 'pieces', 'item',
])

/** Meaningful lowercase words of a product name, pack spec and sizes left out. */
export function nameWords(name: string): Set<string> {
  const base = parseProductName(name).base.toLowerCase()
  return new Set(base.split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)))
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function rankRelated<T extends RelatedCandidate>(product: RelatedCandidate, candidates: T[], n = 6): T[] {
  const mine = nameWords(product.name)
  return candidates
    .filter((c) => c.id !== product.id)
    .map((c) => {
      let shared = 0
      for (const w of nameWords(c.name)) if (mine.has(w)) shared++
      // In stock outweighs one shared word, so a near-identical product that's
      // out of stock doesn't push out a close one a customer can order today.
      const score = Math.min(shared, 3) * 3 + ((c.stock_qty ?? 0) > 0 ? 4 : 0) + ((c.image_url ?? '').trim() ? 1 : 0)
      return { c, score, tie: hash(product.id + c.id) }
    })
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
    .slice(0, n)
    .map((x) => x.c)
}
