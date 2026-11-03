import { editDistance } from '@/lib/email-typo'

// Storefront search helpers: plural-tolerant word matching and "Did you
// mean" suggestions. Pure, so the catalog page and the suggest route share
// them and tests run offline.

/** Words of a search, with chars that would break PostgREST's filter syntax stripped. */
export function searchWords(q: string | null | undefined): string[] {
  return (q ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[%,()]/g, ''))
    .filter(Boolean)
}

/**
 * The word plus the forms it could take in a product name. Matching is
 * substring, so "speaker" already finds "Speakers"; the variants cover the
 * other way round ("speakers" finds "Speaker") and -y/-ies ("bunny" finds
 * "Bunnies"). Every variant is OR'd, so an odd stem only ever broadens.
 */
export function searchVariants(word: string): string[] {
  const w = word.toLowerCase()
  const out = new Set([w])
  const add = (v: string) => { if (v.length >= 3) out.add(v) }
  if (/[^s]s$/.test(w) && w.length >= 4) add(w.slice(0, -1)) // speakers, cookies, cases
  if (/ies$/.test(w)) add(w.slice(0, -3) + 'y') // bunnies, squishies
  if (/(?:ss|x|z|ch|sh)es$/.test(w)) add(w.slice(0, -2)) // glasses, boxes, brushes
  if (/[^aeiou]y$/.test(w)) add(w.slice(0, -1) + 'ie') // bunny -> bunnies
  return [...out]
}

/** PostgREST .or() clause: any variant of the word in any of the fields. */
export function wordOrFilter(word: string, fields: readonly string[]): string {
  return searchVariants(word)
    .flatMap((v) => fields.map((f) => `${f}.ilike.%${v}%`))
    .join(',')
}

/** Word counts from product names, the vocabulary "Did you mean" draws on. */
export function buildVocabulary(names: Iterable<string>): Map<string, number> {
  const vocab = new Map<string, number>()
  for (const name of names) {
    for (const w of name.toLowerCase().split(/[^a-z]+/)) {
      if (w.length >= 3) vocab.set(w, (vocab.get(w) ?? 0) + 1)
    }
  }
  return vocab
}

function isKnown(word: string, vocab: Map<string, number>): boolean {
  const variants = searchVariants(word)
  for (const v of vocab.keys()) if (variants.some((x) => v.includes(x))) return true
  return false
}

/**
 * Closest vocabulary word within 1 edit (2 for words of 7+ letters), most
 * common on ties. Short words and a different first letter are skipped:
 * replaying real empty searches, those gave glue -> blue, sock -> lock,
 * fairy -> dairy.
 */
export function closestWord(word: string, vocab: Map<string, number>): string | null {
  const w = word.toLowerCase()
  if (w.length < 5 || /[^a-z]/.test(w)) return null
  const max = w.length >= 7 ? 2 : 1
  let best: string | null = null
  let bestD = max + 1
  let bestN = 0
  for (const [v, n] of vocab) {
    if (v[0] !== w[0] || Math.abs(v.length - w.length) > max) continue
    const d = editDistance(w, v, max)
    if (d === 0) return null
    if (d < bestD || (d === bestD && n > bestN)) { best = v; bestD = d; bestN = n }
  }
  return bestD <= max ? best : null
}

/**
 * A corrected search ("swuishy" -> "squishy"), or null. Words already in
 * the vocabulary and SKU-like words stay as typed; null if nothing changed
 * or some word is neither known nor fixable (the suggestion would find
 * nothing either).
 */
export function suggestSearch(q: string, vocab: Map<string, number>): string | null {
  const words = searchWords(q)
  if (!words.length) return null
  let changed = false
  const out: string[] = []
  for (const word of words) {
    if (/\d/.test(word) || isKnown(word, vocab)) { out.push(word); continue }
    const fix = closestWord(word, vocab) ?? searchVariants(word).slice(1).map((v) => closestWord(v, vocab)).find(Boolean)
    if (!fix) return null
    out.push(fix)
    changed = true
  }
  return changed ? out.join(' ') : null
}
