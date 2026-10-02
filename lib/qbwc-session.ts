// Whether a QBWC ticket may still be used. A ticket is a bearer credential
// for every write /api/qbwc makes. Until 2026-10-01 tickets never expired:
// closeConnection set closed_at, but nothing checked it, and 1,255 of 3,193
// sessions were never closed at all. Real sessions are short (median ~6s,
// longest ever 2.8 min, measured 2026-10-02), so 2 hours can't cut off a
// genuine run.
export const QBWC_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000

export function isQbwcSessionLive(
  session: { opened_at: string; closed_at: string | null },
  now: number = Date.now(),
): boolean {
  if (session.closed_at) return false
  const opened = new Date(session.opened_at).getTime()
  if (!Number.isFinite(opened)) return false
  return now - opened <= QBWC_SESSION_MAX_AGE_MS
}
