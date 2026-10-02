// The optional shared catalog access code (CATALOG_ACCESS_CODE). Dormant
// unless that env var is set. Shared by middleware.ts and
// /api/catalog-access, so the cookie is minted and checked the same way.
//
// The cookie used to hold the literal string 'granted', so anyone could set
// catalog_access=granted by hand and skip the gate with no code
// (2026-10-02). It now holds an HMAC of the code, which can't be forged
// without the code. Changing the code also invalidates every cookie minted
// under the old one. Web Crypto only, so this runs in middleware and route
// handlers alike.

export const CATALOG_COOKIE = 'catalog_access'

const enc = new TextEncoder()

/** The cookie value that proves knowledge of `code`. */
export async function catalogAccessToken(code: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(code), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('lyusa-catalog-access-v1'))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Does this cookie value grant access under `code`? Constant-time compare. */
export async function hasCatalogAccess(cookieValue: string | undefined, code: string): Promise<boolean> {
  if (!cookieValue) return false
  const expected = await catalogAccessToken(code)
  if (cookieValue.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= cookieValue.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

// /api routes that must work WITHOUT the catalog code, because they're how
// you get in (entering the code, signing in) or they're machines (QuickBooks
// connector, cron, webhooks) that never carry the cookie. Every other /api
// route serves the gated catalog, and with the gate on it returns 401 to a
// caller without access. Until 2026-10-02 every /api route skipped the gate,
// so product search and lookup returned prices to anyone while the catalog
// itself was locked.
const UNGATED_API_ROOTS = [
  '/api/catalog-access',
  '/api/auth',
  '/api/admin/auth',
  '/api/rep/auth',
  '/api/qbwc',
  '/api/sync',
  '/api/webhooks',
]

/** A root matches itself and anything beneath it, never a mere prefix ("/api/syncx"). */
export function isUngatedApi(pathname: string): boolean {
  return UNGATED_API_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`))
}
