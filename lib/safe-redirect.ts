// Redirect targets taken from a URL or form (?next=, ?from=) must stay on this
// site. String checks alone don't hold up:
//   `${origin}${next}` with next=@evil.com   -> https://lyusa.app@evil.com (evil.com)
//   "//evil.com"                             -> protocol-relative, off-site
//   "/\evil.com"                             -> browsers read "\" as "/" -> //evil.com
//   "/\t/evil.com"                           -> tabs/newlines are stripped -> //evil.com
// So parse it the way a browser would, against a placeholder origin, and keep
// it only if the origin didn't change. (2026-10-01 /api audit.)

const PLACEHOLDER_ORIGIN = 'https://internal.invalid'

/**
 * `raw` if it's a same-site path, normalised to path + query + hash.
 * Otherwise `fallback`. Safe for both server redirects and router.push().
 */
export function safeInternalPath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return fallback
  try {
    const url = new URL(raw, PLACEHOLDER_ORIGIN)
    if (url.origin !== PLACEHOLDER_ORIGIN) return fallback
    return url.pathname + url.search + url.hash
  } catch {
    return fallback
  }
}
