/**
 * Product carton measurements — the canonical plausibility rule.
 *
 * UNITS ARE INCHES AND POUNDS. The upstream Erply data is imperial even
 * though WooCommerce's store settings declare kg/cm; see migration 0045's
 * header before writing any conversion.
 *
 * `scripts/build-measurement-worklist.mjs` and
 * `scripts/import-measurement-worklist.mjs` mirror this logic rather than
 * importing it — they're plain .mjs and can't load TypeScript, the same
 * constraint that makes build-measurement-worklist.mjs re-implement
 * lib/pack.ts's pack parsing. **If you change the rule here, change it in
 * both scripts too.** If they drift, one surface flags a carton another
 * accepts.
 */

/** Denser than lead — no carton of giftware is. */
export const LEAD_LB_PER_IN3 = 0.41

/**
 * Absolute bounds, set from the real distribution of the 2,244 cartons
 * backfilled on 2026-09-11 rather than invented: weight p50 30.9 / p99 64 /
 * max 189.6 lb, and dimensions p50 18 / p99 49 / max 188 in. So these reject
 * typos and unit mix-ups, not stock.
 */
export const MAX_WEIGHT_LB = 250
export const MAX_DIMENSION_IN = 120
export const MIN_DIMENSION_IN = 1

export interface CaseMeasurements {
  case_length_in?: number | null
  case_width_in?: number | null
  case_height_in?: number | null
  case_weight_lb?: number | null
}

/**
 * Returns a human-readable reason when a carton can't be real, or null when
 * it's fine (including when it's simply incomplete — absent isn't invalid).
 *
 * Note a sheet or form filled in in CENTIMETRES AND KILOGRAMS is not
 * detectable and this does not pretend to catch it: cm+kg entry lands near
 * 0.0002 lb/in³, while genuine bulky-light products (artificial flowers,
 * ribbon, wreaths) run from 0.00002 up with p1 at 0.00014 — the ranges
 * overlap, so any density floor that caught a metric entry would reject
 * dozens of real cartons. Grams *are* caught, by MAX_WEIGHT_LB.
 */
export function implausibleCaseMeasurement(m: CaseMeasurements): string | null {
  const dims = [m.case_length_in, m.case_width_in, m.case_height_in]

  const tiny = dims.filter((d) => d != null && d < MIN_DIMENSION_IN)
  if (tiny.length > 0) {
    return `dimension under ${MIN_DIMENSION_IN} inch (${tiny.join(', ')}) — likely a placeholder`
  }

  const huge = dims.filter((d) => d != null && d > MAX_DIMENSION_IN)
  if (huge.length > 0) {
    return `dimension over ${MAX_DIMENSION_IN} in (${huge.join(', ')}) — extra digit?`
  }

  if (m.case_weight_lb != null && m.case_weight_lb > MAX_WEIGHT_LB) {
    return `weight over ${MAX_WEIGHT_LB} lb (${m.case_weight_lb}) — entered in grams?`
  }

  if (dims.every((d) => d != null) && m.case_weight_lb != null) {
    const density = m.case_weight_lb / (dims[0]! * dims[1]! * dims[2]!)
    if (density > LEAD_LB_PER_IN3) {
      return `impossible density (${density.toFixed(2)} lb/in³, denser than lead)`
    }
  }

  return null
}

/** Every carton dimension and the weight are present. */
export function hasCompleteCaseMeasurement(m: CaseMeasurements): boolean {
  return (
    m.case_length_in != null &&
    m.case_width_in != null &&
    m.case_height_in != null &&
    m.case_weight_lb != null
  )
}

export const CASE_MEASUREMENT_FIELDS = [
  'case_length_in',
  'case_width_in',
  'case_height_in',
  'case_weight_lb',
] as const

export type CaseMeasurementField = (typeof CASE_MEASUREMENT_FIELDS)[number]

export const CASE_MEASUREMENT_LABELS: Record<CaseMeasurementField, string> = {
  case_length_in: 'L (in)',
  case_width_in: 'W (in)',
  case_height_in: 'H (in)',
  case_weight_lb: 'Weight (lb)',
}

/**
 * Parses one typed-in measurement. Accepts a bare number or a number with a
 * unit suffix a person would plausibly type ('12 in', '12"', '28.4 lb'), and
 * rejects anything holding two numbers ('12 x 8', '12-14') as ambiguous
 * rather than guessing. An empty value is `{ value: null }` — "not measured",
 * which is different from invalid.
 *
 * Kept behaviourally identical to parseCell() in
 * scripts/import-measurement-worklist.mjs.
 */
export function parseMeasurementInput(raw: unknown): { value: number | null; error?: string } {
  if (raw === null || raw === undefined) return { value: null }
  const text = String(raw).trim()
  if (text === '') return { value: null }

  if (/\d\s*(?:[-x×,/]|\bto\b)\s*\d/i.test(text)) {
    return { value: null, error: `ambiguous value "${text}"` }
  }
  const match = text.match(/^([0-9]*\.?[0-9]+)\s*(?:in|inch|inches|"|lb|lbs|pound|pounds)?\.?$/i)
  if (!match) return { value: null, error: `unparseable value "${text}"` }

  const n = Number(match[1])
  if (!Number.isFinite(n)) return { value: null, error: `unparseable value "${text}"` }
  if (n <= 0) return { value: null, error: 'must be greater than zero' }
  // numeric(8,2) in migration 0045.
  if (n > 999999.99) return { value: null, error: 'too large' }

  return { value: Math.round(n * 100) / 100 }
}
