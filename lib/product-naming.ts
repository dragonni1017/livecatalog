/**
 * The house product-name standard, as code.
 *
 *     <Descriptive Name> [Size] - <pk>/pk <bx>bx/cs cs.<total pieces per case>
 *     e.g. "Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120"
 *
 * Derived from the 3,225 live catalog names on 2026-09-16, not invented:
 * 3,013 of them (93%) already carry the full pack-spec suffix, exactly one is
 * ALL CAPS, and sizes appear as inches (315), cm (131) or feet (29).
 *
 * TWO CONVENTIONS, both valid, because this business sells some products by
 * the piece and others by the pack:
 *
 *   PIECE-SOLD  cs.N is the total PIECES per case, so cs === pk * bx
 *               "Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120"
 *
 *   PACK-SOLD   cs.N is the number of PACKS per case, so cs === bx
 *               "10\" Gold Gift Bow - 20/pk 100bx/cs cs.100"
 *               (20 per pack, 100 packs per case — Dragon, confirmed twice:
 *                for the Gift Bows and again for the floral papers)
 *
 * A name is consistent if EITHER holds. Measured over the 3,013 live names
 * carrying a full spec: 1,653 piece-sold, 600 pack-sold, 741 where pk = 1 so
 * the two agree, and 19 consistent under neither — those 19 are the real
 * defects, and scripts/audit-product-names.ts lists them.
 *
 * This replaces an earlier, narrower reading of the standard that treated
 * cs === pk * bx as the only rule. It flagged all 600 pack-sold names as
 * broken, and a verification pass built on it proposed "corrections" that
 * would have rewritten correct names — including reverting the Gift Bow
 * renames made deliberately in an earlier session. The pack-sold shape is
 * self-identifying (cs === bx), so no hand-maintained SKU list is needed.
 *
 * NAMES LIVE IN ERPLY. products.name is overwritten from Erply on every sync
 * (lib/product-sync.ts — name is not in skipFields), so correcting a name in
 * Supabase alone is undone by the next sync. Renames have to go to Erply.
 *
 * Deliberately NOT part of the standard, because the live catalog doesn't use
 * them: the supplier invoice's "Style" suffix (19 of 3,225) and its
 * "100% <material>" tail (0 of 3,225). Invoice English gets rewritten into
 * this shape, never copied verbatim.
 */

export interface PackSpec {
  /** Pieces in a retail pack. */
  piecesPerPack: number
  /** Packs ("boxes") in a case. */
  boxesPerCase: number
  /**
   * The cs.N figure as written. PIECES per case for a piece-sold product,
   * PACKS per case for a pack-sold one — `packSpecConvention` says which.
   */
  piecesPerCase: number
}

export type PackConvention = 'piece' | 'pack' | 'either' | 'inconsistent'

/**
 * Which convention a spec satisfies.
 *
 * 'either' means pk is 1, so pieces and packs per case are the same number
 * and the name doesn't distinguish them — 741 live names are in that state,
 * and nothing needs deciding for them.
 */
export function packSpecConvention(spec: PackSpec): PackConvention {
  const piece = spec.piecesPerCase === spec.piecesPerPack * spec.boxesPerCase
  const pack = spec.piecesPerCase === spec.boxesPerCase
  if (piece && pack) return 'either'
  if (piece) return 'piece'
  if (pack) return 'pack'
  return 'inconsistent'
}

export interface ParsedProductName {
  /** Everything before the " - " pack spec, e.g. "Foam Bear with Heart 7cm". */
  base: string
  /** Null when the name carries no pack spec at all. */
  spec: PackSpec | null
}

// Tolerant on input (spacing, capitalisation) so the audit reads real names
// as they are; strict on output via formatPackSpec.
const SPEC_RE = /\s*-\s*(\d+)\s*\/pk\s+(\d+)\s*bx\/cs(?:\s+cs\.(\d+))?\s*$/i

export function formatPackSpec(piecesPerPack: number, boxesPerCase: number): string {
  return `${piecesPerPack}/pk ${boxesPerCase}bx/cs cs.${piecesPerPack * boxesPerCase}`
}

export function parseProductName(name: string): ParsedProductName {
  const match = SPEC_RE.exec(name ?? '')
  if (!match) return { base: (name ?? '').trim(), spec: null }

  const piecesPerPack = Number(match[1])
  const boxesPerCase = Number(match[2])
  // A name ending "12/pk 10bx/cs" with no cs.N still parses; the total is
  // implied by the invariant rather than read.
  const piecesPerCase = match[3] != null ? Number(match[3]) : piecesPerPack * boxesPerCase

  return {
    base: name.slice(0, match.index).trim(),
    spec: { piecesPerPack, boxesPerCase, piecesPerCase },
  }
}

/**
 * Builds a compliant name. `size` is passed through as written (the catalog
 * legitimately mixes inches, cm and feet depending on how the product is
 * sold) — it is only trimmed and spaced, never converted.
 */
export function buildProductName(args: {
  descriptor: string
  size?: string | null
  piecesPerPack: number
  boxesPerCase: number
}): string {
  const descriptor = normalizeDescriptor(args.descriptor)
  const size = args.size?.trim()
  const head = size ? `${descriptor} ${size}` : descriptor
  return `${head} - ${formatPackSpec(args.piecesPerPack, args.boxesPerCase)}`
}

/**
 * Cleans a descriptor into house shape: collapses whitespace, strips the
 * supplier invoice's trailing "- 100% Polyester" material tail and its
 * "Style" filler, and drops a leading SKU-digit prefix like "7491 - ".
 */
export function normalizeDescriptor(raw: string): string {
  return (raw ?? '')
    .replace(/\s*-\s*100\s*%.*$/i, '')       // "- 100% Zinc Alloy"
    .replace(/\b\s*Style\b/gi, '')            // "Cylinder Style" -> "Cylinder"
    .replace(/^\d{3,6}\s*-\s*/, '')           // legacy "7491 - " prefix
    .replace(/\s+/g, ' ')
    .trim()
}

export type NameIssue =
  | 'missing_pack_spec'
  /**
   * The spec satisfies neither convention — cs.N is neither pk × bx (pieces
   * per case) nor bx (packs per case). 19 live names are in this state and
   * they read like typos, not a third convention.
   */
  | 'case_total_mismatch'
  | 'all_caps'
  | 'leading_sku_digits'
  | 'invoice_material_tail'
  | 'untidy_whitespace'

export interface NameAudit {
  issues: NameIssue[]
  parsed: ParsedProductName
  /** Which convention the spec satisfies; null when there's no spec at all. */
  convention: PackConvention | null
  /** What the name should be, when that can be determined mechanically. */
  suggestion: string | null
}

/**
 * Checks one name against the standard. Only returns a suggestion where the
 * fix is unambiguous — a missing pack spec can't be invented, since the
 * pack/case counts aren't in the name to begin with, and a spec that fits
 * neither convention doesn't say which of its three numbers is wrong.
 */
export function auditProductName(name: string): NameAudit {
  const parsed = parseProductName(name)
  const issues: NameIssue[] = []
  const convention = parsed.spec ? packSpecConvention(parsed.spec) : null

  if (!parsed.spec) issues.push('missing_pack_spec')
  else if (convention === 'inconsistent') issues.push('case_total_mismatch')

  const trimmed = (name ?? '').trim()
  if (trimmed && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) issues.push('all_caps')
  if (/^\d{3,6}\s*-\s/.test(trimmed)) issues.push('leading_sku_digits')
  if (/\b100\s*%/.test(trimmed)) issues.push('invoice_material_tail')
  if (trimmed !== name || /\s{2,}/.test(name ?? '')) issues.push('untidy_whitespace')

  // A suggestion is only offered for COSMETIC problems. A spec that fits
  // neither convention says the name is internally inconsistent; it does NOT
  // say which of its three numbers is wrong, so there is nothing to propose.
  //
  // Two separate attempts to be cleverer here both turned out wrong, which is
  // why this stays deliberately unhelpful:
  //   - Recomputing cs.N as pk x bx: F287672 arrives 150 per case and reads
  //     "48/pk 150bx/cs cs.150", so that would have written cs.7200.
  //   - Treating a supplier document's pieces-per-carton as the case quantity:
  //     it isn't, for a pack-sold product. Dragon confirmed the floral papers
  //     are 20 per pack with 60 packs per case, while their documents read 60
  //     pieces per carton — so a "correction" built on that evidence would
  //     have rewritten 225 correct names.
  // The 19 genuinely inconsistent names need a human per SKU.
  const cosmetic = issues.filter(
    (i) => i !== 'missing_pack_spec' && i !== 'case_total_mismatch',
  )
  let suggestion: string | null = null
  if (parsed.spec && cosmetic.length > 0) {
    const rebuilt = `${normalizeDescriptor(parsed.base)} - ${parsed.spec.piecesPerPack}/pk ${parsed.spec.boxesPerCase}bx/cs cs.${parsed.spec.piecesPerCase}`
    if (rebuilt !== name) suggestion = rebuilt
  }

  return { issues, parsed, convention, suggestion }
}
