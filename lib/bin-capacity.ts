/**
 * How many cases of a product fit in a bin.
 *
 * Pairs the carton measurements from migration 0045
 * (`products.case_*_in` / `case_weight_lb`) with the bin dimensions from 0046
 * (`bin_types.length_in` / `width_in` / `height_in` / `max_weight_lb`).
 *
 * EVERYTHING HERE IS INCHES AND POUNDS. Both migrations store imperial and
 * name their columns accordingly; this module does no conversion, so feeding
 * it centimetres produces a confident wrong answer.
 *
 * ── The packing model, and its limits ──────────────────────────────────────
 *
 * Optimal 3D bin packing is NP-hard, and a warehouse doesn't pack optimally
 * anyway. This uses the model that matches how uniform cases are actually
 * stacked: every case in the same orientation, in a regular grid.
 *
 *     floor(binL / caseL) x floor(binW / caseW) x floor(binH / caseH)
 *
 * evaluated for all six ways of aligning the case to the bin's axes, keeping
 * the best. The `floor` calls are the whole point — they charge for the dead
 * space a naive `binVolume / caseVolume` silently gives away. A 24x18x12 bin
 * and a 10x10x10 case: volume division says 5 cases fit; only 2 actually do.
 *
 * What this deliberately does NOT model, because each would need data the
 * warehouse doesn't hold:
 *
 *   - Mixed orientations (some cases turned to fill a gap). Real packers do
 *     this, so the answer here is a floor, not a ceiling.
 *   - Stacking strength. A case crushes under enough cases above it; nothing
 *     in the data says how many. The bin's weight limit is the only load
 *     check, and it is a limit on the shelf, not on the bottom carton.
 *   - Aisle access, overhang, pallet height, fire clearance.
 *
 * So treat the result as "how many will physically go in", not "how many to
 * put in".
 */

export interface BinDimensions {
  length_in?: number | null
  width_in?: number | null
  height_in?: number | null
  max_weight_lb?: number | null
}

export interface CartonDimensions {
  case_length_in?: number | null
  case_width_in?: number | null
  case_height_in?: number | null
  case_weight_lb?: number | null
}

/** Which limit decides the answer. */
export type BindingConstraint =
  /** The bin's interior filled up first. */
  | 'volume'
  /** The bin's weight limit was reached first. */
  | 'weight'
  /** Both ran out at the same count. */
  | 'both'
  /** A single case doesn't fit in the bin in any orientation. */
  | 'does-not-fit'

export interface BinCapacityResult {
  /** Cases that fit, respecting every known limit. 0 if one won't go in. */
  cases: number
  /** Cases the interior allows, ignoring weight. */
  casesByVolume: number
  /**
   * Cases the weight limit allows, ignoring geometry. null when the bin has
   * no recorded weight limit — unknown, so it isn't treated as a constraint.
   */
  casesByWeight: number | null
  binding: BindingConstraint
  /** The case orientation used, as the bin's [length, width, height]. */
  orientation: [number, number, number] | null
  /** Share of the bin's interior volume occupied, 0–1. */
  volumeUtilisation: number
  /** Total weight of a full bin, or null if the case weight is unknown. */
  loadedWeightLb: number | null
}

/** Why a capacity figure can't be produced at all. */
export type MissingCapacityInput =
  | 'bin-dimensions'
  | 'carton-dimensions'

const positive = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v)

/**
 * The six ways to align a box to a set of axes: each of the three edges can
 * take the bin's length, and the remaining two can swap.
 */
function orientations(l: number, w: number, h: number): [number, number, number][] {
  return [
    [l, w, h],
    [l, h, w],
    [w, l, h],
    [w, h, l],
    [h, l, w],
    [h, w, l],
  ]
}

/**
 * Cases that fit by geometry alone, and the orientation achieving it.
 * Exported because it's the part worth checking independently of weight.
 */
export function fitByVolume(
  bin: BinDimensions,
  carton: CartonDimensions,
): { cases: number; orientation: [number, number, number] | null } {
  const binL = positive(bin.length_in)
  const binW = positive(bin.width_in)
  const binH = positive(bin.height_in)
  const cl = positive(carton.case_length_in)
  const cw = positive(carton.case_width_in)
  const ch = positive(carton.case_height_in)
  if (binL == null || binW == null || binH == null || cl == null || cw == null || ch == null) {
    return { cases: 0, orientation: null }
  }

  let best = 0
  let bestOrientation: [number, number, number] | null = null
  for (const [a, b, c] of orientations(cl, cw, ch)) {
    const count = Math.floor(binL / a) * Math.floor(binW / b) * Math.floor(binH / c)
    if (count > best) {
      best = count
      bestOrientation = [a, b, c]
    }
  }
  return { cases: best, orientation: bestOrientation }
}

/**
 * Full capacity for one bin/carton pair, or a reason the inputs don't allow
 * an answer. Returns a discriminated union so a caller can't accidentally
 * render "0 cases fit" when the truth is "nobody has measured this bin".
 */
export function binCapacity(
  bin: BinDimensions,
  carton: CartonDimensions,
): { ok: true; result: BinCapacityResult } | { ok: false; missing: MissingCapacityInput } {
  const binL = positive(bin.length_in)
  const binW = positive(bin.width_in)
  const binH = positive(bin.height_in)
  if (binL == null || binW == null || binH == null) {
    return { ok: false, missing: 'bin-dimensions' }
  }

  const cl = positive(carton.case_length_in)
  const cw = positive(carton.case_width_in)
  const ch = positive(carton.case_height_in)
  if (cl == null || cw == null || ch == null) {
    return { ok: false, missing: 'carton-dimensions' }
  }

  const { cases: casesByVolume, orientation } = fitByVolume(bin, carton)

  const caseWeight = positive(carton.case_weight_lb)
  const binMaxWeight = positive(bin.max_weight_lb)
  // Unknown weight on either side means weight can't constrain anything. That
  // is reported as null rather than Infinity so a caller has to decide how to
  // present it, instead of showing a number that looks measured.
  const casesByWeight =
    caseWeight != null && binMaxWeight != null ? Math.floor(binMaxWeight / caseWeight) : null

  const cases = casesByWeight == null ? casesByVolume : Math.min(casesByVolume, casesByWeight)

  let binding: BindingConstraint
  if (cases === 0) {
    // Zero from geometry means the case is simply too big. Zero once weight is
    // applied means one case already exceeds the shelf rating -- still a real
    // "won't go in", so both report does-not-fit.
    binding = 'does-not-fit'
  } else if (casesByWeight == null || casesByVolume < casesByWeight) {
    binding = 'volume'
  } else if (casesByWeight < casesByVolume) {
    binding = 'weight'
  } else {
    binding = 'both'
  }

  const binVolume = binL * binW * binH
  const cartonVolume = cl * cw * ch

  return {
    ok: true,
    result: {
      cases,
      casesByVolume,
      casesByWeight,
      binding,
      orientation,
      volumeUtilisation: binVolume > 0 ? (cases * cartonVolume) / binVolume : 0,
      loadedWeightLb: caseWeight != null ? Math.round(cases * caseWeight * 100) / 100 : null,
    },
  }
}

/**
 * How many bins of this type are needed to hold a given number of cases.
 * Returns null when a case won't fit at all, since no number of bins helps.
 */
export function binsNeededForCases(
  bin: BinDimensions,
  carton: CartonDimensions,
  caseCount: number,
): number | null {
  if (!Number.isFinite(caseCount) || caseCount <= 0) return 0
  const capacity = binCapacity(bin, carton)
  if (!capacity.ok || capacity.result.cases === 0) return null
  return Math.ceil(caseCount / capacity.result.cases)
}

export const BINDING_LABELS: Record<BindingConstraint, string> = {
  volume: 'Space',
  weight: 'Weight limit',
  both: 'Space and weight',
  'does-not-fit': "Doesn't fit",
}
