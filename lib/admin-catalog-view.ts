import { draftMode } from 'next/headers'
import { getSessionUser } from './auth-server'

/**
 * "Show all products" on the storefront: true only when an admin turned it
 * on (/admin/api/storefront-view) AND is still signed in as an admin.
 *
 * Built on Next's Draft Mode: its cookie makes this one browser skip every
 * page cache (the product page's ISR included), so hidden and inactive
 * products can be listed for an admin while the cached pages every customer
 * gets never contain them. The cookie alone grants nothing — the admin role
 * is checked on every request — and the session lookup only runs when the
 * cookie is present, so ordinary visits stay as cheap as before.
 */
export async function showAllProducts(): Promise<boolean> {
  const { isEnabled } = await draftMode()
  if (!isEnabled) return false
  try {
    const user = await getSessionUser()
    return user?.app_metadata?.role === 'admin'
  } catch {
    return false
  }
}

/** Why a customer can't see this product, or null when they can. */
export function hiddenReason(p: { is_active?: boolean | null; manually_hidden?: boolean | null }): string | null {
  if (p.is_active === false) return 'Inactive'
  if (p.manually_hidden) return 'Hidden'
  return null
}
