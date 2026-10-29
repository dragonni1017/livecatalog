// "Did you mean ...?" for mistyped email domains. Pure.
//
// Three real quote requests (2026-09..10) were sent with a broken domain
// (gmai.com, gmail.ocm, ioud.com), so every status email to those customers
// bounced. This only SUGGESTS a fix: the customer decides, and nothing is
// ever changed or blocked automatically, since a rare real domain can look
// like a typo.

/** Common consumer email domains; a domain close to one of these is probably a typo. */
export const COMMON_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'live.com',
  'msn.com',
  'me.com',
  'ymail.com',
  'comcast.net',
  'att.net',
  'sbcglobal.net',
  'verizon.net',
] as const

/**
 * Real domains that sit within a typo's distance of a common one. Never
 * question these (myyahoo.com is Yahoo's own; found on a real sign-in
 * account 2026-10-29).
 */
export const KNOWN_REAL_DOMAINS = [
  'myyahoo.com', 'rocketmail.com', 'mail.com', 'gmx.com', 'mac.com', 'email.com', 'live.ca', 'yahoo.ca', 'hotmail.ca',
  'yahoo.co.uk', 'hotmail.co.uk', 'att.com', 'ameritech.net', 'charter.net', 'cox.net', 'aim.com',
] as const

/** Top-level domains that are almost always a slip for .com or .net. */
const TLD_TYPOS: Record<string, string> = {
  con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', cpm: 'com', comm: 'com', co: 'com', om: 'com', cm: 'com',
  nte: 'net', ent: 'net', nett: 'net',
}

/** Levenshtein distance, capped: returns max+1 as soon as it can't be within max. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/**
 * A corrected address if the domain looks like a typo of a common one, else
 * null. Leaves well-formed uncommon domains (company emails) alone unless
 * they are one or two edits from a common provider.
 */
export function suggestEmailFix(email: string): string | null {
  const at = email.trim().lastIndexOf('@')
  if (at < 1) return null
  const local = email.trim().slice(0, at)
  const domain = email.trim().slice(at + 1).toLowerCase()
  if (!domain || (COMMON_EMAIL_DOMAINS as readonly string[]).includes(domain)) return null
  if ((KNOWN_REAL_DOMAINS as readonly string[]).includes(domain)) return null

  // 1. A slipped top-level domain on an otherwise common provider: gmail.ocm, yahoo.con
  const dot = domain.lastIndexOf('.')
  if (dot > 0) {
    const name = domain.slice(0, dot)
    const fixedTld = TLD_TYPOS[domain.slice(dot + 1)]
    if (fixedTld) {
      const candidate = `${name}.${fixedTld}`
      if ((COMMON_EMAIL_DOMAINS as readonly string[]).includes(candidate)) return `${local}@${candidate}`
    }
  }

  // 2. A near-miss of a common provider: gmai.com, gmial.com, ioud.com, hotmial.com
  let best: string | null = null
  let bestDist = Infinity
  for (const d of COMMON_EMAIL_DOMAINS) {
    // Short domains (me.com, att.net) need a tighter match to avoid false hits.
    const max = d.length <= 7 ? 1 : 2
    const dist = editDistance(domain, d, max)
    if (dist <= max && dist < bestDist) {
      best = d
      bestDist = dist
    }
  }
  return best ? `${local}@${best}` : null
}
