/**
 * WooCommerce REST API client — customer half.
 *
 * No shared Woo client existed before this (every script/route re-implemented
 * Basic Auth + fetch inline — see scripts/check-woo-customer-changes.mjs,
 * scripts/compare-erply-woo.mjs). This one backs app/api/sync/customers.
 *
 * Auth: WooCommerce REST API v3, Basic Auth via consumer key/secret.
 * Requires WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET.
 */

export interface WooCustomer {
  id: number
  email: string
  first_name: string
  last_name: string
  role: string
}

/**
 * WP roles that mean "staff/dev account", never a real customer. Confirmed
 * live 2026-08-07: every account with an `administrator` role in the
 * Woo-not-in-Erply diff was internal (site owner, agency devs, WooCommerce
 * support) — see docs/memory/project-woocommerce-customer-role-filter-bug.md.
 * The Woo->Erply direction must never create an Erply customer for one of
 * these.
 */
export const NON_CUSTOMER_WOO_ROLES = new Set(['administrator', 'shop_manager', 'editor', 'author', 'contributor'])

export function isWooConfigured(): boolean {
  return Boolean(process.env.WOO_STORE_URL && process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET)
}

function storeUrl(): string {
  const raw = process.env.WOO_STORE_URL!
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withProtocol.replace(/\/+$/, '')
}

function authHeader(): string {
  const token = Buffer.from(`${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

async function wooFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${storeUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  return res
}

export async function getWooCustomerByEmail(email: string): Promise<WooCustomer | null> {
  // role=all is required -- wc/v3/customers defaults to role=customer and
  // silently excludes anyone with a Wholesale Suite role (default_wholesaler,
  // chain, retail, exclusive, distributor). Confirmed live 2026-08-07: a
  // known-real customer with role default_wholesaler returned [] without
  // role=all and the correct record with it. Omitting this produced a false
  // "customer doesn't exist" for ~3,180 real Woo accounts this session.
  const res = await wooFetch(`/wp-json/wc/v3/customers?role=all&email=${encodeURIComponent(email)}`)
  if (!res.ok) throw new Error(`Woo HTTP ${res.status} looking up customer by email`)
  const list: WooCustomer[] = await res.json()
  return list[0] ?? null
}

/** Full paginated pull of all Woo customers — needed for the Woo->Erply diff. */
export async function getAllWooCustomers(): Promise<WooCustomer[]> {
  const perPage = 100
  let page = 1
  const all: WooCustomer[] = []
  while (true) {
    // role=all — see getWooCustomerByEmail's comment; without it this silently
    // returns only ~6 of ~3,182 real customers (anyone not on the bare
    // "customer" role, i.e. every Wholesale Suite-tiered account).
    const res = await wooFetch(`/wp-json/wc/v3/customers?role=all&per_page=${perPage}&page=${page}&orderby=id&order=asc`)
    if (!res.ok) throw new Error(`Woo HTTP ${res.status} listing customers (page ${page})`)
    const batch: WooCustomer[] = await res.json()
    all.push(...batch)
    if (batch.length < perPage) break
    page++
  }
  return all
}

export async function createWooCustomer(input: {
  email: string
  firstName?: string | null
  lastName?: string | null
  roleSlug?: string | null
}): Promise<WooCustomer> {
  const res = await wooFetch('/wp-json/wc/v3/customers', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      first_name: input.firstName ?? '',
      last_name: input.lastName ?? '',
      ...(input.roleSlug ? { role: input.roleSlug } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Woo HTTP ${res.status} creating customer ${input.email}: ${await res.text()}`)
  return res.json()
}

// ── Products (name corrections only -- see lib/product-name-fix.ts) ──────────

export type WooProductLookup =
  | { ok: true; product: { id: number; name: string } | null }
  | { ok: false; status: number }

/**
 * One product by SKU. status=any is required: wc/v3/products defaults to
 * published only, so a draft or private product would otherwise read as "not
 * in WooCommerce" -- and this store has drafts on purpose
 * (docs/memory/project-woo-direct-outofstock-write.md).
 *
 * Returns the HTTP status instead of throwing so a caller can report it per
 * product rather than abandon a batch.
 */
export async function getWooProductBySku(sku: string): Promise<WooProductLookup> {
  const res = await wooFetch(`/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&status=any`)
  if (!res.ok) return { ok: false, status: res.status }
  const list: Array<{ id: number; name: string }> = await res.json()
  const first = list[0]
  return { ok: true, product: first ? { id: first.id, name: first.name } : null }
}

/**
 * Renames one product. Returns the name WooCommerce echoes back so the caller
 * can confirm it stuck (Woo has silently reverted other writes on this store --
 * see project-woo-direct-outofstock-write), or the status + body on failure.
 */
export async function updateWooProductName(
  wooProductId: number,
  name: string,
): Promise<{ ok: true; name: string } | { ok: false; status: number; body: string }> {
  const res = await wooFetch(`/wp-json/wc/v3/products/${wooProductId}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
  const body = await res.text()
  if (!res.ok) return { ok: false, status: res.status, body }
  return { ok: true, name: String(JSON.parse(body).name ?? '') }
}

export async function updateWooCustomerRole(wooCustomerId: number, roleSlug: string): Promise<WooCustomer> {
  const res = await wooFetch(`/wp-json/wc/v3/customers/${wooCustomerId}`, {
    method: 'PUT',
    body: JSON.stringify({ role: roleSlug }),
  })
  if (!res.ok) throw new Error(`Woo HTTP ${res.status} updating role for customer ${wooCustomerId}: ${await res.text()}`)
  return res.json()
}
