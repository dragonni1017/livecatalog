/**
 * A QuickBooks Desktop sales description, turned into a product-name
 * descriptor: the part of a house-standard name before " - <pack spec>".
 *
 * QuickBooks descriptions carry the carton and the case pack along with the
 * product, e.g. "Yellow Sunflower Butterfly Paper - 60pk/cs - 25" x 13" x 6"
 * - 40lbs". Copied into a name as-is, that text reached the live catalog: 88
 * products created from the 2026-09-23 container were named from raw
 * descriptions (docs/memory/project-qb-product-create-plan-20261001.md).
 *
 * Shared by the receiving "fill names from QuickBooks" button
 * (app/admin/api/qbwc/item-pull) and scripts/create-products-from-qb.ts, so
 * the two can't strip differently. The pack figures are removed, never turned
 * into a spec here: the pack split needs a human (receiving's pieces-per-pack
 * field, or the fill sheet).
 */

import { normalizeDescriptor } from './product-naming.ts'

const NUM = String.raw`(\d+(?:\.\d+)?)`
const DIM_UNIT = String.raw`\s*("|''|in(?:ch(?:es)?)?\b|cm\b|mm\b)?`
/** Carton dimensions: `23" x 16" x 11"`, `25x25x25`, `20 x 15 x18`. */
export const CARTON_DIMS_RE = new RegExp(`${NUM}${DIM_UNIT}\\s*[x×]\\s*${NUM}${DIM_UNIT}\\s*[x×]\\s*${NUM}${DIM_UNIT}`, 'i')
/** Carton weight: `17 lbs`, `42lbs`, `8 kg`. */
export const CARTON_WEIGHT_RE = new RegExp(`${NUM}\\s*(lbs?|pounds?|kgs?)\\b`, 'i')

/**
 * Pack tokens, in the order they must be matched: "N/bx/cs" before "N/bx".
 *   containers per case  "60pk/cs", "150 pk's/cs", "24/bx/cs", "16bx/cs"
 *   sets per case        "12sets/cs"
 *   pieces per pack      "12/pk", "50pc/pk", "12/bx", "24pcs/bx"
 *   pieces per case      "48 pcs/cs", "24/cs", "240pc/cs"
 */
export const PACK_TOKEN_RES = [
  /(\d+)\s*\/?\s*(pk's|pks|pk|bx|box(?:es)?)\s*\/\s*cs\b/i,
  /(\d+)\s*sets?\s*\/\s*cs\b/i,
  /(\d+)\s*(?:pcs?|pc)?\s*\/\s*(?:pk|bx)\b/i,
  /(\d+)\s*(?:pcs?|pc)?\s*\/\s*cs\b/i,
]

const MINOR = new Set(['a', 'an', 'and', 'of', 'with', 'w/', 'w', 'the', 'in', 'for', 'or', 'to', 'on', 'at', '&'])
/** Capitalises all-lowercase words only; anything already carrying a capital (LOVE, MOM, POE, 3D) is kept. */
export function titleCaseDescriptor(s: string): string {
  const cap = (w: string) => w.replace(/^([^A-Za-z0-9]*)([a-z])/, (_, p, c) => p + c.toUpperCase()) // "(orange)" -> "(Orange)"
  return s.split(' ').map((word, i) => {
    if (!word || word !== word.toLowerCase()) {
      // "Beige/pink" -> "Beige/Pink"; leave "w/" alone
      return word.includes('/') && word !== 'w/' ? word.split('/').map((p) => (p === p.toLowerCase() && !/^\d/.test(p) ? cap(p) : p)).join('/') : word
    }
    if (i > 0 && MINOR.has(word)) return word
    if (/^\d/.test(word)) return word // 40oz, 650ml, 2-pc, 8ribbed stay as written
    return word.includes('/') && word !== 'w/' ? word.split('/').map(cap).join('/') : cap(word)
  }).join(' ')
}

const SIZE_SEG_RE = /^\d+(?:\.\d+)?\s*(?:cm|mm|inch(?:es)?|in|"|ft|feet)$/i

export interface QbDescriptor {
  /** Descriptor plus any size segment, e.g. "Corgi Companion Plush 60cm". Empty when nothing is left. */
  head: string
  /** The descriptor alone, without size segments. */
  descriptor: string
  /** The size came from the SKU suffix ("P273833-30cm"), not the description. */
  sizeFromSku: string | null
  /** Carton dimensions or weight were present and removed. */
  hadCarton: boolean
}

export function descriptorFromQbDesc(desc: string, sku = ''): QbDescriptor {
  let rest = (desc ?? '').replace(/\r?\n/g, ' - ')
    // "Corgi Companion Plush-60cm 12/cs": a size glued on with a hyphen
    .replace(/([A-Za-z])-(\d+(?:\.\d+)?(?:cm|inch|in)\b)/gi, '$1 - $2')

  let hadCarton = false
  for (const re of [CARTON_DIMS_RE, CARTON_WEIGHT_RE]) {
    const m = re.exec(rest)
    if (m) { rest = rest.replace(m[0], ' '); hadCarton = true }
  }
  for (const re of PACK_TOKEN_RES) {
    for (let m = re.exec(rest); m; m = re.exec(rest)) rest = rest.replace(m[0], ' ')
  }

  // "4 Style" means four styles assorted. normalizeDescriptor strips the
  // supplier-invoice filler word "Style", which would turn "4 Style Plush
  // Cup" into "4 Plush Cup" -- so protect the counted form first.
  const protectedText = rest.replace(/(\d+)\s*-?\s*style(s)?\b/gi, '$1§')
  const segs = protectedText.split(/\s+-\s+|\s*-\s*$|^\s*-\s*/)
    .map((s) => s.replace(/^[\s,.-]+|[\s,.-]+$/g, '').trim()).filter(Boolean)
  const sizes = segs.filter((s) => SIZE_SEG_RE.test(s))
  const words = segs.filter((s) => !SIZE_SEG_RE.test(s))
  let descriptor = normalizeDescriptor(words.join(' ')).replace(/(\d+)§/g, '$1 Style')
  descriptor = titleCaseDescriptor(descriptor.replace(/\s+/g, ' ').trim())

  // A size encoded in a variant SKU ("P273833-30cm") that the desc omits.
  let sizeFromSku: string | null = null
  const skuSize = /-(\d+(?:cm|inch|in))$/i.exec(sku)?.[1]
  if (skuSize && !sizes.length && !new RegExp(`\\b${skuSize}\\b`, 'i').test(descriptor)) {
    sizeFromSku = skuSize.toLowerCase()
    sizes.push(sizeFromSku)
  }
  return { head: [descriptor, ...sizes].filter(Boolean).join(' '), descriptor, sizeFromSku, hadCarton }
}
