import { waitAge } from './order-age.ts'

// "Waiting N days" for the dashboard's review-queue cards (Name review,
// Price review): how long the oldest pending item has sat. Days are Los
// Angeles calendar days (lib/order-age.ts); stale after a full work week
// untouched.

export const STALE_BUSINESS_DAYS = 5

export interface QueueAge {
  text: string
  stale: boolean
  /** Calendar days the oldest item has waited (0 = today). */
  days: number
}

const days = (n: number) => (n === 0 ? 'today' : n === 1 ? '1 day' : `${n} days`)

/** Age of the oldest of `createdAts`, or null when there are none. */
export function queueAge(createdAts: (string | null | undefined)[], nowIso: string): QueueAge | null {
  const valid = createdAts.filter((c): c is string => !!c && !Number.isNaN(Date.parse(c)))
  if (!valid.length) return null
  const oldest = valid.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a))
  const age = waitAge(oldest, nowIso)
  return {
    text: age.calendarDays === 0 ? 'added today' : `oldest waiting ${days(age.calendarDays)}`,
    stale: age.businessDays >= STALE_BUSINESS_DAYS,
    days: age.calendarDays,
  }
}

/** "last searched today" / "last searched 3 days ago" for the most recent of `iso`s. */
export function lastSeen(isos: string[], nowIso: string): string | null {
  const valid = isos.filter((c) => !Number.isNaN(Date.parse(c)))
  if (!valid.length) return null
  const newest = valid.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))
  const n = waitAge(newest, nowIso).calendarDays
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`
}
