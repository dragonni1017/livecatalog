// How long a quote request has been waiting for a first response
// (docs/ORDER-FOLLOW-UP-PLAN.md part 3). Pure.
//
// "Waiting" = still status 'new' and not dismissed (migration 0069).
// Age is counted in Los Angeles calendar dates, so it doesn't flip at
// midnight UTC. A business day is Monday to Friday (no holiday calendar).
// Decided 2026-10-29: amber after 1 business day, red after 3.

import { todayPacific } from '@/lib/collections'

export const AMBER_BUSINESS_DAYS = 1
export const RED_BUSINESS_DAYS = 3

export type WaitLevel = 'fresh' | 'amber' | 'red'

export interface WaitableOrder {
  status: string
  dismissed_at: string | null
  created_at: string
}

export function isWaiting(o: Pick<WaitableOrder, 'status' | 'dismissed_at'>): boolean {
  return o.status === 'new' && !o.dismissed_at
}

/** A timestamp's date (YYYY-MM-DD) in Los Angeles. */
export function pacificDate(iso: string): string {
  return todayPacific(new Date(iso))
}

function utcDay(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Whole calendar days from one YYYY-MM-DD to another (0 if the same day or later). */
export function calendarDaysBetween(from: string, to: string): number {
  return Math.max(0, utcDay(to) - utcDay(from))
}

/**
 * Weekdays after `from` up to and including `to`, so an order from Friday
 * is 1 business day old on Monday, and one from today is 0.
 */
export function businessDaysBetween(from: string, to: string): number {
  const start = utcDay(from)
  const end = utcDay(to)
  let n = 0
  for (let d = start + 1; d <= end; d++) {
    const dow = new Date(d * 86_400_000).getUTCDay()
    if (dow !== 0 && dow !== 6) n++
  }
  return n
}

export function waitLevel(businessDays: number): WaitLevel {
  if (businessDays >= RED_BUSINESS_DAYS) return 'red'
  if (businessDays >= AMBER_BUSINESS_DAYS) return 'amber'
  return 'fresh'
}

export interface WaitAge {
  calendarDays: number
  businessDays: number
  level: WaitLevel
}

export function waitAge(createdAt: string, nowIso: string): WaitAge {
  const from = pacificDate(createdAt)
  const to = pacificDate(nowIso)
  const businessDays = businessDaysBetween(from, to)
  return { calendarDays: calendarDaysBetween(from, to), businessDays, level: waitLevel(businessDays) }
}

export interface WaitingSummary {
  count: number
  oldestCalendarDays: number
  totalCents: number
}

export function summarizeWaiting(
  orders: (WaitableOrder & { subtotal_cents: number })[],
  nowIso: string,
): WaitingSummary {
  const waiting = orders.filter(isWaiting)
  let oldest = 0
  let total = 0
  for (const o of waiting) {
    oldest = Math.max(oldest, waitAge(o.created_at, nowIso).calendarDays)
    total += o.subtotal_cents ?? 0
  }
  return { count: waiting.length, oldestCalendarDays: oldest, totalCents: total }
}
