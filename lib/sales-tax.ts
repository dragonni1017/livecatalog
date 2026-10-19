// Estimated sales tax by ship-to state (migration 0066, docs/SALES-TAX-PLAN.md).
//
// The app only ESTIMATES: one rate per state, set at /admin/sales-tax.
// QuickBooks Desktop charges the real tax on the invoice, so no tax amount is
// ever sent to it (it would be charged twice). This file is the only place the
// rule lives, the same way lib/customer-pricing.ts is for prices.
//
// Rule, for a subtotal already net of tier/customer/promo pricing:
//   1. No active rate for the ship-to state -> $0, "not collected".
//   2. A verified, unexpired, not-replaced resale certificate FOR THAT STATE
//      -> $0, exempt. (Callers pass certificates only for a buyer signed in as
//      the order email; guests have none.)
//   3. Otherwise round-half-up(subtotal x rate) on the whole order.
// A pending certificate for the state doesn't exempt; it's flagged so the
// buyer can be told tax comes off once it's verified.

import { normalizeUsState, US_STATE_NAMES } from '@/lib/us-states'
import type { ResaleCertificate } from '@/lib/resale-certificates'

export const SALES_TAX_FIELDS = 'state, rate_percent, is_active, note, updated_at, updated_by'
export const MAX_RATE_PERCENT = 20
export const MAX_NOTE_CHARS = 200

export interface SalesTaxState {
  state: string
  rate_percent: number | string // numeric comes back from PostgREST as a string
  is_active: boolean
  note: string | null
  updated_at: string
  updated_by: string | null
}

export type TaxExemptReason = 'resale_certificate' | 'not_collected'

export interface TaxEstimate {
  /** Normalized ship-to state, or null when there isn't a recognizable one. */
  state: string | null
  /** Rate applied, or null when nothing was charged. */
  ratePercent: number | null
  taxCents: number
  exemptReason: TaxExemptReason | null
  /** A pending certificate exists for this state: tax is shown but may come off. */
  certificatePending: boolean
}

export type TaxCertificate = Pick<ResaleCertificate, 'state' | 'status' | 'expires_on' | 'replaced_at'>

/** Active rates only, keyed by state code. */
export function activeRates(rows: Pick<SalesTaxState, 'state' | 'rate_percent' | 'is_active'>[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) if (r.is_active) out.set(r.state, Number(r.rate_percent))
  return out
}

// A certificate that applies to `state` on `today` (YYYY-MM-DD). Undated
// certificates count as current, the same as the expiry reminders treat them.
function certApplies(c: TaxCertificate, state: string, today: string): boolean {
  return !c.replaced_at && c.state === state && !(c.expires_on && c.expires_on < today)
}

// Integer math: rate to millionths of a percent-unit, so 7.25% of $10.00 is
// exactly 72.5 -> 73 cents rather than whatever 1000 * 0.0725 floats to.
export function taxOn(subtotalCents: number, ratePercent: number): number {
  if (subtotalCents <= 0 || ratePercent <= 0) return 0
  const microRate = Math.round(ratePercent * 10_000) // 7.25 -> 72_500 (per 1_000_000)
  return Math.floor((subtotalCents * microRate + 500_000) / 1_000_000)
}

export function estimateSalesTax(args: {
  shipState: string | null | undefined
  subtotalCents: number
  rates: Map<string, number>
  certificates: TaxCertificate[]
  today: string
}): TaxEstimate {
  const state = normalizeUsState(args.shipState)
  const rate = state ? args.rates.get(state) : undefined
  if (!state || rate == null) {
    return { state, ratePercent: null, taxCents: 0, exemptReason: 'not_collected', certificatePending: false }
  }
  const current = args.certificates.filter((c) => certApplies(c, state, args.today))
  if (current.some((c) => c.status === 'verified')) {
    return { state, ratePercent: null, taxCents: 0, exemptReason: 'resale_certificate', certificatePending: false }
  }
  return {
    state,
    ratePercent: rate,
    taxCents: taxOn(args.subtotalCents, rate),
    exemptReason: null,
    certificatePending: current.some((c) => c.status === 'pending'),
  }
}

/** Validates one /admin/sales-tax row. */
export function parseSalesTaxInput(
  body: unknown,
): { value: { state: string; rate_percent: number; is_active: boolean; note: string | null } } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const state = typeof b.state === 'string' ? b.state.trim().toUpperCase() : ''
  if (!US_STATE_NAMES[state]) return { error: 'Pick a state.' }
  const raw = typeof b.rate_percent === 'number' ? String(b.rate_percent) : typeof b.rate_percent === 'string' ? b.rate_percent.trim() : ''
  if (!/^\d{1,2}(\.\d{1,4})?$/.test(raw)) return { error: 'Rate must be a percent like 7.25 (up to 4 decimals).' }
  const rate = Number(raw)
  if (rate > MAX_RATE_PERCENT) return { error: `Rate can't be over ${MAX_RATE_PERCENT}%.` }
  const note = typeof b.note === 'string' ? b.note.trim() : ''
  if (note.length > MAX_NOTE_CHARS) return { error: `Note can't be over ${MAX_NOTE_CHARS} characters.` }
  return { value: { state, rate_percent: rate, is_active: b.is_active !== false, note: note || null } }
}
