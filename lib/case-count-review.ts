// Case-count review (migration 0072, /admin/case-count-review). Pure.
//
// The case count lives in the name's pack spec ("12/pk 20bx/cs cs.240"):
// pieces per case = pieces per pack x packs per case (the case_pieces
// generated column, migration 0054). Changing it is a rename, done through
// lib/product-name-fix.ts like Name review. Here ONLY the case part may
// change: the description and the pieces per pack stay exactly as they are.

import { packSpecConvention, parseProductName } from './product-naming.ts'

export interface CaseCountEvidence {
  /** Where the number comes from: "Latest shipment", "QuickBooks", "Photo label", ... */
  source: string
  /** Pieces per case by this source, or null when it gives no single number. */
  count: number | null
  detail: string
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Pieces per case stated by a name's pack spec, or null without one. */
export function casePiecesOf(name: string): number | null {
  const spec = parseProductName(name).spec
  return spec ? spec.piecesPerPack * spec.boxesPerCase : null
}

/**
 * The name with its case changed to `pieces` per case, keeping the
 * description, the pieces per pack and the cs.N convention (pieces for a
 * piece-sold name, packs for a pack-sold one, any stated unit kept). Null
 * when it can't be done safely: no pack spec, an inconsistent one, or
 * `pieces` not a whole number of packs.
 */
export function withCaseCount(name: string, pieces: number): string | null {
  const { base, spec } = parseProductName(name)
  if (!spec || !Number.isInteger(pieces) || pieces <= 0) return null
  const convention = packSpecConvention(spec)
  if (convention === 'inconsistent') return null
  if (pieces % spec.piecesPerPack !== 0) return null
  const boxes = pieces / spec.piecesPerPack
  const csN = convention === 'pack' ? boxes : pieces
  const unit = spec.caseUnit ?? ''
  return `${base} - ${spec.piecesPerPack}/pk ${boxes}bx/cs cs.${csN}${unit}`
}

/**
 * Whether `to` changes only the case count of `from`. The description and
 * pieces per pack must be unchanged, the new spec must be self-consistent,
 * and the count must actually differ.
 */
export function checkCaseCountChange(from: string, to: string): { ok: true; pieces: number } | { ok: false; error: string } {
  const a = parseProductName(from)
  const b = parseProductName(to)
  if (!a.spec) return { ok: false, error: 'The current name has no pack spec, so its case count cannot be changed here.' }
  if (!b.spec) return { ok: false, error: 'The new name needs a pack spec, like "12/pk 20bx/cs cs.240".' }
  if (norm(a.base) !== norm(b.base)) return { ok: false, error: 'Only the case count can change here; the description part must stay the same (use Name review for that).' }
  if (a.spec.piecesPerPack !== b.spec.piecesPerPack) return { ok: false, error: `Pieces per pack must stay ${a.spec.piecesPerPack}; only the case count can change here.` }
  if (packSpecConvention(b.spec) === 'inconsistent') return { ok: false, error: 'The new pack spec does not add up (check bx/cs against cs.N).' }
  const pieces = b.spec.piecesPerPack * b.spec.boxesPerCase
  if (pieces === a.spec.piecesPerPack * a.spec.boxesPerCase) return { ok: false, error: 'That is the same case count. Use "Name is right" to keep it.' }
  return { ok: true, pieces }
}

/** Distinct whole counts from the evidence, each with the sources that give it, excluding the current one. */
export function caseCountOptions(evidence: CaseCountEvidence[], current: number | null): { count: number; sources: string[] }[] {
  const by = new Map<number, string[]>()
  for (const e of evidence) {
    if (e.count == null || !Number.isInteger(e.count) || e.count <= 0 || e.count === current) continue
    by.set(e.count, [...(by.get(e.count) ?? []), e.source])
  }
  return [...by].map(([count, sources]) => ({ count, sources })).sort((x, y) => y.sources.length - x.sources.length || x.count - y.count)
}
