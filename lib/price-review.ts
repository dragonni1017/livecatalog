// Price review decisions (migration 0070, /admin/price-review). Pure.
//
// A website price must already be on the site's rounding grid (.00, .25,
// .50; never .75; lib/order-rules.ts roundCentsToQuarterSkip75), because a
// held price only releases once Erply sends the exact same cents (0068).

import { roundCentsToQuarterSkip75 } from '@/lib/order-rules'

export type ReviewAction = 'approve' | 'skip' | 'reopen'

export interface ReviewRequest {
  id: string
  action: ReviewAction
  /** Approve only: the price to set, in cents. */
  cents?: number
}

export function isOnPriceGrid(cents: number): boolean {
  return Number.isInteger(cents) && cents > 0 && roundCentsToQuarterSkip75(cents) === cents
}

/** Dollars text ("12.5", "$12.50") to cents, or null if it isn't a price. */
export function parseDollars(text: string): number | null {
  const t = text.trim().replace(/^\$/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100)
}

export function parseReviewBody(body: unknown): ReviewRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request' }
  const b = body as Record<string, unknown>
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  if (!id) return { error: 'Missing id' }
  if (b.action !== 'approve' && b.action !== 'skip' && b.action !== 'reopen') {
    return { error: 'Action must be approve, skip or reopen' }
  }
  if (b.action !== 'approve') return { id, action: b.action }
  if (typeof b.cents !== 'number' || !isOnPriceGrid(b.cents)) {
    const near = typeof b.cents === 'number' && b.cents > 0 ? roundCentsToQuarterSkip75(Math.round(b.cents)) : null
    return { error: near ? `Prices end in .00, .25 or .50. Try $${(near / 100).toFixed(2)}.` : 'Enter a price above $0.' }
  }
  return { id, action: 'approve', cents: b.cents }
}
