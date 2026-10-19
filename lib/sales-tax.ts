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

import type { getAdminClient } from '@/lib/supabase'
import { normalizeUsState, US_STATE_NAMES } from '@/lib/us-states'
import { formatPriceCents } from '@/lib/order-rules'
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

// ── Loading and showing ──────────────────────────────────────────────────────

/**
 * Active rates plus the certificates of `certEmail`, for estimateSalesTax.
 * Pass an email ONLY for a buyer signed in as the order email, or a rep
 * pricing for that customer; never a guest's typed email, or anyone who knew
 * a certified customer's address would get the exemption.
 */
export async function loadTaxInputs(
  db: ReturnType<typeof getAdminClient>,
  certEmail: string | null,
): Promise<{ rates: Map<string, number>; certificates: TaxCertificate[] }> {
  const [{ data: rateRows, error }, certs] = await Promise.all([
    db.from('sales_tax_states').select('state, rate_percent, is_active').eq('is_active', true),
    certEmail
      ? db.from('resale_certificates').select('state, status, expires_on, replaced_at').eq('email', certEmail.trim().toLowerCase()).is('replaced_at', null)
      : Promise.resolve({ data: [] as TaxCertificate[] }),
  ])
  // Missing table (0066 not applied) or a read error: estimate nothing rather
  // than block a quote. The order still goes through without a tax line.
  if (error) console.error('[sales-tax] rates read failed:', error.message)
  return {
    rates: activeRates((rateRows ?? []) as Pick<SalesTaxState, 'state' | 'rate_percent' | 'is_active'>[]),
    certificates: (certs.data ?? []) as TaxCertificate[],
  }
}

/** The order_requests snapshot columns (migration 0066) for an estimate. */
export function taxColumns(e: TaxEstimate) {
  return {
    tax_state: e.state,
    tax_rate_percent: e.ratePercent,
    tax_estimate_cents: e.taxCents,
    tax_exempt_reason: e.exemptReason,
  }
}

export interface OrderTaxFields {
  tax_state?: string | null
  tax_rate_percent?: number | string | null
  tax_estimate_cents?: number | null
  tax_exempt_reason?: string | null
}

export const TAX_ESTIMATE_NOTE = 'Final sales tax is on your invoice.'

/**
 * The line to show under an order's subtotal, or null for none: orders from
 * before 0066, and states where tax isn't collected, show nothing at all.
 */
export function orderTaxLine(o: OrderTaxFields): { label: string; cents: number } | null {
  if (o.tax_estimate_cents == null || o.tax_exempt_reason === 'not_collected') return null
  if (o.tax_exempt_reason === 'resale_certificate') {
    return { label: `Sales tax: exempt (resale certificate${o.tax_state ? `, ${o.tax_state}` : ''})`, cents: 0 }
  }
  const rate = o.tax_rate_percent != null ? `${Number(o.tax_rate_percent)}%` : ''
  return { label: `Estimated sales tax (${[o.tax_state, rate].filter(Boolean).join(' ')})`, cents: o.tax_estimate_cents }
}

/** Plain-text lines for emails and the QuickBooks memo, or [] for none. */
export function taxTextLines(o: OrderTaxFields, subtotalCents: number): string[] {
  const line = orderTaxLine(o)
  if (!line) return []
  if (line.cents === 0) return [line.label]
  return [`${line.label}: ${formatPriceCents(line.cents)}`, `Estimated total: ${formatPriceCents(subtotalCents + line.cents)}`]
}

/**
 * One line for the QuickBooks sales order memo, so whoever reviews it sees
 * the app's estimate. Text only: never a tax line item, since QuickBooks
 * applies its own tax and would charge it twice. Null when there's none.
 */
export function taxMemoLine(o: OrderTaxFields): string | null {
  const line = orderTaxLine(o)
  if (!line) return null
  if (o.tax_exempt_reason === 'resale_certificate') return `Tax exempt: resale cert${o.tax_state ? ` ${o.tax_state}` : ''}`
  return `Est. tax ${[o.tax_state, o.tax_rate_percent != null ? `${Number(o.tax_rate_percent)}%` : ''].filter(Boolean).join(' ')}: ${formatPriceCents(line.cents)} (app estimate)`
}
