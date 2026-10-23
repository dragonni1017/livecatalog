/**
 * Seasonal products, for ordering work by how soon a holiday makes it
 * worthless. Used by the Needs pricing tab of /admin/cleanup: an unpriced
 * Halloween item a week before Halloween is worth more attention than a
 * plain ribbon that sells all year.
 *
 * Matching is on the product name only. Keywords are deliberately narrow:
 * "heart", "bunny", "sunflower" and "skeleton" (Shark Skeleton Plush) sell
 * all year, so they are not treated as seasonal.
 */

export type SeasonKey =
  | 'valentines'
  | 'st-patricks'
  | 'easter'
  | 'mothers-day'
  | 'graduation'
  | 'july-4'
  | 'halloween'
  | 'thanksgiving'
  | 'christmas'

interface SeasonDef {
  key: SeasonKey
  label: string
  pattern: RegExp
  /** The day the season ends in a given year, at UTC midnight. */
  date: (year: number) => Date
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

/** The nth given weekday (0 = Sunday) of a month. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = utc(year, month, 1).getUTCDay()
  return utc(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7)
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
export function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return utc(year, month, day)
}

// Checked in order; the first match wins.
const SEASONS: SeasonDef[] = [
  { key: 'christmas', label: 'Christmas', pattern: /christmas|\bx-?mas\b|grinch|santa|reindeer|snowman/i, date: (y) => utc(y, 12, 25) },
  { key: 'halloween', label: 'Halloween', pattern: /halloween|pumpkin|spooky|\bwitch|\bghost/i, date: (y) => utc(y, 10, 31) },
  { key: 'thanksgiving', label: 'Thanksgiving', pattern: /thanksgiving|\bfall\b|autumn|harvest/i, date: (y) => nthWeekday(y, 11, 4, 4) },
  { key: 'valentines', label: "Valentine's", pattern: /valentine/i, date: (y) => utc(y, 2, 14) },
  { key: 'st-patricks', label: "St. Patrick's", pattern: /st\.? ?patrick|shamrock/i, date: (y) => utc(y, 3, 17) },
  { key: 'easter', label: 'Easter', pattern: /easter/i, date: easterSunday },
  { key: 'mothers-day', label: "Mother's Day", pattern: /mother'?s day|\bmom\b|\bmama\b/i, date: (y) => nthWeekday(y, 5, 0, 2) },
  // Graduation runs May into June; June 1 is roughly when orders stop.
  { key: 'graduation', label: 'Graduation', pattern: /\bgrad\b|graduat|congrats|class of/i, date: (y) => utc(y, 6, 1) },
  { key: 'july-4', label: 'July 4th', pattern: /4th of july|fourth of july|american flag|\busa\b|patriotic/i, date: (y) => utc(y, 7, 4) },
]

/** After the holiday, a season counts as just over for this long. */
export const SEASON_OVER_DAYS = 45

/** Seasons closer than this sort to the top of the list. */
export const SEASON_SOON_DAYS = 120

export interface SeasonInfo {
  key: SeasonKey
  label: string
  /** Whole days from today (UTC) to the next holiday; 0 on the day itself. */
  daysLeft: number
  /** The holiday passed within SEASON_OVER_DAYS: pricing it can wait a year. */
  over: boolean
}

const DAY_MS = 86_400_000

export function seasonOf(name: string, now: Date = new Date()): SeasonInfo | null {
  const def = SEASONS.find((s) => s.pattern.test(name))
  if (!def) return null
  const today = utc(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate())
  const year = today.getUTCFullYear()
  let next = def.date(year)
  if (next < today) next = def.date(year + 1)
  const prev = def.date(next.getUTCFullYear() - 1)
  const daysSince = Math.round((today.getTime() - prev.getTime()) / DAY_MS)
  return {
    key: def.key,
    label: def.label,
    daysLeft: Math.round((next.getTime() - today.getTime()) / DAY_MS),
    over: daysSince <= SEASON_OVER_DAYS,
  }
}

/** Seasonal and due within SEASON_SOON_DAYS. */
export function isSeasonSoon(s: SeasonInfo | null): boolean {
  return s !== null && !s.over && s.daysLeft <= SEASON_SOON_DAYS
}

/**
 * Sort order for work lists: seasons coming up soonest first, then
 * everything else (0, so the caller's tie-break decides). A season that just
 * ended goes last, after the year-round products.
 */
export function compareBySeason(a: SeasonInfo | null, b: SeasonInfo | null): number {
  const rank = (s: SeasonInfo | null) => (isSeasonSoon(s) ? 0 : s?.over ? 2 : 1)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 0) return a!.daysLeft - b!.daysLeft
  return 0
}
