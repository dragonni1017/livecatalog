// Why a quote didn't go through: the reasons recorded with the
// 'quote_submit_blocked' analytics event (stored in analytics_events.source,
// migration 0075) and shown on /admin/analytics. Pure.

export const QUOTE_BLOCK_REASONS = [
  'missing_name',
  'missing_email',
  'invalid_email',
  'missing_street',
  'missing_city',
  'missing_state',
  'missing_zip',
  'missing_other',
  'empty_cart',
  'below_minimum',
  'submit_failed',
] as const

export type QuoteBlockReason = (typeof QUOTE_BLOCK_REASONS)[number]

export const QUOTE_BLOCK_LABELS: Record<QuoteBlockReason, string> = {
  missing_name: 'Name left empty',
  missing_email: 'Email left empty',
  invalid_email: 'Email not valid',
  missing_street: 'Street address left empty',
  missing_city: 'City left empty',
  missing_state: 'State not picked',
  missing_zip: 'ZIP left empty',
  missing_other: 'Another required field left empty',
  empty_cart: 'Cart was empty',
  below_minimum: 'Below the order minimum',
  submit_failed: 'Sent, but the server refused it',
}

export function isQuoteBlockReason(v: unknown): v is QuoteBlockReason {
  return typeof v === 'string' && (QUOTE_BLOCK_REASONS as readonly string[]).includes(v)
}

/**
 * The reason for a field the browser refused to submit, from its label
 * ("Email *", "Ship to — address *", "City *", ...) and whether the value was
 * the wrong type (an email without "@").
 */
export function blockedFieldReason(label: string, typeMismatch: boolean): QuoteBlockReason {
  const l = label.toLowerCase()
  if (l.includes('email')) return typeMismatch ? 'invalid_email' : 'missing_email'
  if (l.includes('address')) return 'missing_street'
  if (l.includes('city')) return 'missing_city'
  if (l.includes('state')) return 'missing_state'
  if (l.includes('zip')) return 'missing_zip'
  if (l.includes('name')) return 'missing_name'
  return 'missing_other'
}
