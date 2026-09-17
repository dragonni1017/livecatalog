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
 * THE INVARIANT: cs.N is ALWAYS the total pieces per case, so cs === pk * bx.
 * Dragon's call, 2026-09-16. It settles a real split in the live data — 2,394
 * names already meant pieces, but 600 used cs.N for the box count and 19 were
 * neither (e.g. "Brown Small Ribbon 1.5\" - 15/pk 3bx/cs cs.36", where
 * 15 x 3 = 45). Those 619 are wrong under this standard; scripts/audit-product-names.mjs
 * lists them.
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
  /** Total pieces in a case. Always piecesPerPack * boxesPerCase. */
  piecesPerCase: number
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

/**
 * SKUs sold BY THE PACK rather than by the piece, where `cs.N` counts packs
 * and therefore does NOT equal pk × bx.
 *
 * This is a real, Dragon-confirmed exception, not a set of mistakes: the 8
 * Gift Bows were deliberately renamed to "20/pk 100bx/cs cs.100" in an
 * earlier session — 20 per pack, 100 packs per case — and
 * `scripts/fix-bows-pack-spec-erply-woo.mjs` records the reasoning. Treating
 * them as inconsistent would propose reverting that decision (the
 * verification tool did exactly that before this list existed, suggesting
 * cs.1000).
 *
 * The list is explicit rather than pattern-matched because nothing in a SKU
 * or a name says how a product is sold — only a human knows. Add to it when
 * another range is confirmed as pack-sold; don't infer membership.
 */
export const PACK_SOLD_SKUS = new Set<string>([
  'F286796', // 10" Red Gift Bow
  'F286797', // 10" Fuchsia Gift Bow
  'F286798', // 10" Pink Gift Bow
  'F286799', // 10" White Gift Bow
  'F286800', // 10" Silver Gift Bow
  'F286801', // 10" Gold Gift Bow
  'F286802', // 10" Royal Blue Gift Bow
  'F286803', // 10" Sky Blue Gift Bow
])

export function isSoldByPack(sku: string): boolean {
  return PACK_SOLD_SKUS.has(sku.toUpperCase())
}

export type NameIssue =
  | 'missing_pack_spec'
  | 'case_total_mismatch'
  | 'all_caps'
  | 'leading_sku_digits'
  | 'invoice_material_tail'
  | 'untidy_whitespace'

export interface NameAudit {
  issues: NameIssue[]
  parsed: ParsedProductName
  /** What the name should be, when that can be determined mechanically. */
  suggestion: string | null
}

/**
 * Checks one name against the standard. Only returns a suggestion where the
 * fix is unambiguous — a missing pack spec can't be invented, since the
 * pack/case counts aren't in the name to begin with.
 */
export function auditProductName(name: string, opts: { sku?: string } = {}): NameAudit {
  const parsed = parseProductName(name)
  const issues: NameIssue[] = []
  // A pack-sold product's cs.N counts packs, so pk x bx is the wrong test for
  // it — see PACK_SOLD_SKUS. Pass the SKU to get that right; without one, a
  // pack-sold name reads as inconsistent.
  const soldByPack = opts.sku ? isSoldByPack(opts.sku) : false

  if (!parsed.spec) issues.push('missing_pack_spec')
  else if (
    !soldByPack &&
    parsed.spec.piecesPerCase !== parsed.spec.piecesPerPack * parsed.spec.boxesPerCase
  ) {
    issues.push('case_total_mismatch')
  }

  const trimmed = (name ?? '').trim()
  if (trimmed && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) issues.push('all_caps')
  if (/^\d{3,6}\s*-\s/.test(trimmed)) issues.push('leading_sku_digits')
  if (/\b100\s*%/.test(trimmed)) issues.push('invoice_material_tail')
  if (trimmed !== name || /\s{2,}/.test(name ?? '')) issues.push('untidy_whitespace')

  // A suggestion is only offered for COSMETIC problems. A cs.N that isn't
  // pk x bx tells you the name is internally inconsistent — it does NOT tell
  // you which of the three numbers is wrong, and recomputing cs.N from pk and
  // bx is demonstrably the wrong guess for a large class of them.
  //
  // Checked against real shipments 2026-09-16: F287672 arrived as 10 cartons
  // of 1,500 pieces — 150 per case — and its name reads "48/pk 150bx/cs
  // cs.150". There, cs.N is the truthful figure and `bx` is the field holding
  // the wrong value; recomputing would have rewritten it to cs.7200, a 48x
  // overstatement. F287778 is the same. Meanwhile T642121 ("12/pk 5bx/cs
  // cs.60", 60/carton) and F287491 ("1/pk 36bx/cs cs.36", 36/carton) are
  // internally consistent AND match their shipments.
  //
  // So these need a physical or supplier-document check per SKU, not
  // arithmetic. The invariant governs names written from here on.
  const cosmetic = issues.filter(
    (i) => i !== 'missing_pack_spec' && i !== 'case_total_mismatch',
  )
  let suggestion: string | null = null
  if (parsed.spec && cosmetic.length > 0) {
    const rebuilt = `${normalizeDescriptor(parsed.base)} - ${parsed.spec.piecesPerPack}/pk ${parsed.spec.boxesPerCase}bx/cs cs.${parsed.spec.piecesPerCase}`
    if (rebuilt !== name) suggestion = rebuilt
  }

  return { issues, parsed, suggestion }
}
