// "Recently viewed" products, kept in the visitor's own browser
// (localStorage), never sent anywhere. Each entry is the name and photo at
// the time of viewing; no price, so a changed price can't be shown stale.

export interface RecentItem {
  id: string
  name: string
  image_url: string | null
}

export const RECENT_KEY = 'recently_viewed_v1'
export const RECENT_MAX = 12

/** Newest first, no duplicates, at most RECENT_MAX. Pure. */
export function addRecent(list: RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((x) => x.id !== item.id)].slice(0, RECENT_MAX)
}

/** Parse a stored value; [] for anything that isn't a list of items. Pure. */
export function parseRecent(stored: string | null): RecentItem[] {
  try {
    const raw = JSON.parse(stored ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string')
      .map((x) => ({ id: x.id, name: x.name, image_url: typeof x.image_url === 'string' ? x.image_url : null }))
      .slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

/** What's stored, or [] when storage is unavailable. */
export function readRecent(): RecentItem[] {
  try {
    return parseRecent(localStorage.getItem(RECENT_KEY))
  } catch {
    return []
  }
}

export function rememberRecent(item: RecentItem): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(addRecent(readRecent(), item)))
  } catch {
    // Private mode / storage blocked: the strip just doesn't appear.
  }
}
