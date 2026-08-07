/**
 * Erply API client
 *
 * Stub mode: runs when ERPLY_CLIENT_CODE is not set — returns sample data so
 * the cron and sync routes work end-to-end before credentials are available.
 *
 * To activate real mode: set ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
 * in your Vercel environment variables and remove the stub guard in getSessionKey().
 */

import { DEFAULT_TIER, type ErplyTier } from './tier-mapping'

// ── Erply API response shapes ─────────────────────────────────────────────────

interface ErplyStatus {
  request: string
  responseStatus: 'ok' | 'error'
  errorCode?: number
  errorField?: string
  recordsTotal?: number
}

interface ErplyResponse<T> {
  status: ErplyStatus
  records: T[]
}

/** Shape of one product record returned by Erply's getProducts call */
interface ErplyProduct {
  productID: number
  code: string        // primary SKU / item code
  code2: string       // alternate code
  name: string
  price: number       // default selling price (incl. tax if applicable)
  netPrice: number    // selling price before tax
  groupID: number
  groupName: string   // maps to our category.name
  description: string
  active: 0 | 1
  // Erply's documented `images` array has no `isPrimary` flag -- fields are
  // pictureID, name, thumbURL, smallURL, largeURL, fullURL, external,
  // hostingProvider, hash, tenant. Also gated: empty/absent entirely unless
  // Erply support has enabled image API access for the account.
  images: Array<{ largeURL: string; fullURL: string }>
  /**
   * Included when getStockInfo=1 is passed. NOT a flat amountInStock field --
   * Erply returns a per-warehouse dictionary keyed by warehouse ID. Confirmed
   * live: this account has warehouse 1 "L&Y USA" and warehouse 2 "Store LA".
   */
  warehouses?: Record<string, { warehouseID: number; totalInStock: number; reserved: number }>
}

// Public catalog price (decided 2026-08-06): the livecatalog storefront now
// shows Erply's actual Wholesale tier price -- 50% off the retail-anchored
// price, matching the live Wholesale price list's discountPercent (see
// docs/memory/project-retail-anchor-pricing-flip.md) -- rather than the
// retail+20% markup used before. Superseded WHOLESALE_MARKUP=1.2.
const WHOLESALE_DISCOUNT = 0.5

// Storefront prices are rounded to quarters, skipping .75: a price lands on
// x.00, x.25, x.50, or rounds up to the next whole dollar (whichever of
// those four stops is nearest) -- decided 2026-08-06, never x.75.
function roundToQuarterSkip75(amount: number): number {
  const dollars = Math.floor(amount)
  const cents = Math.round((amount - dollars) * 100)
  const stops = [0, 25, 50, 100]
  let nearest = stops[0]
  let minDiff = Infinity
  for (const stop of stops) {
    const diff = Math.abs(cents - stop)
    if (diff < minDiff) {
      minDiff = diff
      nearest = stop
    }
  }
  return nearest === 100 ? dollars + 1 : dollars + nearest / 100
}

// ── Normalized type used by the sync route ────────────────────────────────────

export interface ErplySyncProduct {
  sku: string
  barcode: string | null
  name: string
  price: number       // dollars, not cents
  categoryName: string
  description: string
  imageUrl: string | null
  stockQty: number
  isActive: boolean
}

// ── Config helpers ────────────────────────────────────────────────────────────

export function isConfigured(): boolean {
  return Boolean(
    process.env.ERPLY_CLIENT_CODE &&
    process.env.ERPLY_USERNAME &&
    process.env.ERPLY_PASSWORD
  )
}

function apiUrl(): string {
  return `https://${process.env.ERPLY_CLIENT_CODE}.erply.com/api/`
}

async function erplyPost<T>(params: Record<string, string>): Promise<ErplyResponse<T>> {
  const body = new URLSearchParams({
    clientCode: process.env.ERPLY_CLIENT_CODE!,
    ...params,
  })
  const res = await fetch(apiUrl(), { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getSessionKey(): Promise<string> {
  // TODO: remove this guard once ERPLY_CLIENT_CODE / USERNAME / PASSWORD are set
  if (!isConfigured()) return 'stub-session-key'

  const data = await erplyPost<{ sessionKey: string }>({
    request: 'verifyUser',
    username: process.env.ERPLY_USERNAME!,
    password: process.env.ERPLY_PASSWORD!,
  })
  return data.records[0].sessionKey
}

// ── Product fetch (paginated) ─────────────────────────────────────────────────

const PAGE_SIZE = 300

async function fetchProductPage(
  sessionKey: string,
  pageNo: number,
): Promise<{ products: ErplyProduct[]; total: number }> {
  const data = await erplyPost<ErplyProduct>({
    request: 'getProducts',
    sessionKey,
    recordsOnPage: String(PAGE_SIZE),
    pageNo: String(pageNo),
    getImages: '1',
    getStockInfo: '1',  // includes amountInStock / reservedAmount on each record
    active: '1',        // only active products
  })
  return {
    products: data.records,
    total: data.status.recordsTotal ?? 0,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getErplyProducts(): Promise<ErplySyncProduct[]> {
  if (!isConfigured()) {
    console.log('[erply] Running in stub mode — set ERPLY_CLIENT_CODE to use real data')
    return STUB_PRODUCTS
  }

  const sessionKey = await getSessionKey()

  // Fetch first page to get total count
  const first = await fetchProductPage(sessionKey, 1)
  const allRaw: ErplyProduct[] = [...first.products]
  const total = first.total

  // Don't precompute totalPages as ceil(total / PAGE_SIZE): Erply silently
  // caps each page at 200 records whenever getStockInfo=1 is passed (see
  // fetchProductPage), regardless of the recordsOnPage value requested here
  // (PAGE_SIZE=300). Assuming a fixed 300-per-page rate would undercount the
  // pages needed and truncate the sync by ~30% (confirmed live: 2870 total
  // products, 200 actually returned per page). Instead, keep requesting
  // pages until we've collected everything Erply reported; a page shorter
  // than requested (or empty) ends the loop as a safety net.
  let page = 2
  while (allRaw.length < total) {
    const { products } = await fetchProductPage(sessionKey, page)
    if (products.length === 0) break
    allRaw.push(...products)
    page++
  }

  return allRaw.map(normalizeProduct)
}

function normalizeProduct(p: ErplyProduct): ErplySyncProduct {
  // No isPrimary field exists on Erply's response -- take the first listed
  // image. NOTE: this is still Erply's own hosted URL (fullURL), which their
  // API docs say must not be hotlinked -- it must be downloaded and re-served
  // from infrastructure we control (see scripts/download-erply-images.mjs +
  // upload-images-to-cloudinary.mjs) before going live. Do not wire this
  // straight into image_url without that step, or a real sync will both
  // violate Erply's terms and silently overwrite the working Cloudinary URLs
  // already on ~1,028 products with a batch of unoptimized, ToS-violating
  // hotlinks (see docs/memory/project-erply-image-backfill.md).
  const primaryImage = p.images?.[0]

  // Stock is a per-warehouse dictionary, not a flat amountInStock field.
  // Confirmed live: warehouse 1 "L&Y USA" and warehouse 2 "Store LA" both
  // exist, and both currently read 0 for every sampled product -- summing
  // across all warehouses here, but if "Store LA" is retail-only stock that
  // shouldn't count toward wholesale availability, this needs to be scoped
  // to a specific warehouseID instead (open decision, see
  // docs/memory/project-erply-pagination-fix.md).
  const stockQty = Object.values(p.warehouses ?? {}).reduce(
    (sum, w) => sum + (w.totalInStock ?? 0),
    0
  )

  return {
    sku: (p.code || String(p.productID)).trim(),
    barcode: p.code2?.trim() || null,
    name: p.name,
    price: roundToQuarterSkip75((p.price ?? p.netPrice ?? 0) * WHOLESALE_DISCOUNT),
    categoryName: p.groupName ?? '',
    description: p.description ?? '',
    imageUrl: primaryImage?.fullURL ?? primaryImage?.largeURL ?? null,
    stockQty,
    isActive: p.active === 1,
  }
}

// ── Customer sync (Erply <-> WooCommerce bridge, see lib/tier-mapping.ts) ──────

/**
 * Erply's CRM API (not the classic API) hosts customer groups. Endpoint is a
 * shared regional URL with no client-code subdomain -- must be looked up live
 * via classic API getServiceEndpoints, never assumed from a naming pattern
 * (confirmed in docs/memory/project-erply-customer-tiers.md — a hardcoded
 * guess 404'd from every machine that tried it).
 */
async function fetchErplyCrmApiUrl(): Promise<string> {
  const data = await erplyPost<Record<string, { url?: string }>>({ request: 'getServiceEndpoints' })
  const endpoints = data.records?.[0] ?? {}
  const key = Object.keys(endpoints).find((k) => /crm|customer/i.test(k))
  if (!key) throw new Error(`No CRM-like key in getServiceEndpoints response: ${Object.keys(endpoints).join(', ')}`)
  const url = String((endpoints as Record<string, { url?: string }>)[key]?.url ?? '').replace(/\/+$/, '')
  if (!url) throw new Error(`Key "${key}" had no .url field`)
  return url
}

interface ErplyCustomerGroupRaw {
  id: number
  name?: { en?: string } | string
}

/** Live group id -> tier name, resolved fresh every call (never hardcode ids — group ids have shifted before). */
export async function getErplyCustomerGroups(): Promise<Array<{ id: number; name: string }>> {
  const sessionKey = await getSessionKey()
  const crmApiUrl = await fetchErplyCrmApiUrl()
  const res = await fetch(`${crmApiUrl}/v1/customers/groups`, {
    headers: { clientCode: process.env.ERPLY_CLIENT_CODE!, sessionKey },
  })
  if (!res.ok) throw new Error(`Erply CRM HTTP ${res.status} fetching customer groups`)
  const json = await res.json()
  const raw: ErplyCustomerGroupRaw[] = json.records ?? json
  return raw
    .map((g) => ({ id: g.id, name: typeof g.name === 'string' ? g.name : g.name?.en ?? '' }))
    .filter((g) => g.name)
}

const KNOWN_TIERS = new Set<string>(['Base', 'Wholesale', 'Retail', 'Distribution-Chain', 'Exclusive'])

export interface ErplySyncCustomer {
  customerID: string
  email: string
  tier: ErplyTier
  firstName: string | null
  lastName: string | null
  companyName: string | null
}

interface ErplyCustomerRaw {
  customerID: number
  groupID: number
  email?: string
  firstName?: string
  lastName?: string
  companyName?: string
}

async function fetchCustomerPage(
  sessionKey: string,
  pageNo: number,
): Promise<{ customers: ErplyCustomerRaw[]; total: number }> {
  const data = await erplyPost<ErplyCustomerRaw>({
    request: 'getCustomers',
    sessionKey,
    recordsOnPage: String(PAGE_SIZE),
    pageNo: String(pageNo),
  })
  return { customers: data.records, total: data.status.recordsTotal ?? 0 }
}

/**
 * Full paginated pull of Erply customers, tier-resolved. Skips records with
 * no usable email and de-dupes by email (keeps the first occurrence) -- both
 * per Dragon's confirmed rule, see docs/memory/project-woocommerce-tier-mapping.md.
 */
export async function getErplyCustomers(): Promise<ErplySyncCustomer[]> {
  if (!isConfigured()) {
    console.log('[erply] Running in stub mode — getErplyCustomers returns no customers')
    return []
  }

  const sessionKey = await getSessionKey()
  const groups = await getErplyCustomerGroups()
  const groupTierMap = new Map<number, ErplyTier>()
  for (const g of groups) {
    if (KNOWN_TIERS.has(g.name)) groupTierMap.set(g.id, g.name as ErplyTier)
  }

  const first = await fetchCustomerPage(sessionKey, 1)
  const allRaw: ErplyCustomerRaw[] = [...first.customers]
  const total = first.total
  let page = 2
  while (allRaw.length < total) {
    const { customers } = await fetchCustomerPage(sessionKey, page)
    if (customers.length === 0) break
    allRaw.push(...customers)
    page++
  }

  const seenEmails = new Set<string>()
  const result: ErplySyncCustomer[] = []
  let skippedNoEmail = 0
  let skippedDupEmail = 0
  for (const c of allRaw) {
    const email = c.email?.trim().toLowerCase()
    if (!email) {
      skippedNoEmail++
      continue
    }
    if (seenEmails.has(email)) {
      skippedDupEmail++
      continue
    }
    seenEmails.add(email)
    result.push({
      customerID: String(c.customerID),
      email,
      tier: groupTierMap.get(c.groupID) ?? DEFAULT_TIER,
      firstName: c.firstName?.trim() || null,
      lastName: c.lastName?.trim() || null,
      companyName: c.companyName?.trim() || null,
    })
  }
  console.log(
    `[erply] getErplyCustomers: ${result.length} usable, ${skippedNoEmail} skipped (no email), ${skippedDupEmail} skipped (dup email)`,
  )
  return result
}

/**
 * Creates a new Erply customer via the classic API's saveCustomer request.
 * UNVERIFIED — this call has never been made live in this codebase. Hand-test
 * against one throwaway customer (confirm the response actually contains
 * customerID in the shape assumed below) before this is ever invoked from
 * the daily cron. See docs/memory/project-woocommerce-tier-mapping.md.
 */
export async function createErplyCustomer(input: {
  email: string
  firstName?: string | null
  lastName?: string | null
  tier: ErplyTier
}): Promise<{ customerID: string }> {
  if (!isConfigured()) {
    throw new Error('[erply] createErplyCustomer called while Erply is not configured (stub mode)')
  }
  const sessionKey = await getSessionKey()
  const groups = await getErplyCustomerGroups()
  const targetGroup = groups.find((g) => g.name === input.tier)

  const params: Record<string, string> = {
    request: 'saveCustomer',
    sessionKey,
    email: input.email,
  }
  if (input.firstName) params.firstName = input.firstName
  if (input.lastName) params.lastName = input.lastName
  if (targetGroup) params.groupID = String(targetGroup.id)

  const data = await erplyPost<{ customerID: number }>(params)
  const customerID = data.records?.[0]?.customerID
  if (!customerID) throw new Error(`saveCustomer returned no customerID: ${JSON.stringify(data)}`)
  return { customerID: String(customerID) }
}

// ── Stub data (used when Erply credentials are not yet configured) ─────────────

const STUB_PRODUCTS: ErplySyncProduct[] = [
  {
    sku: 'DEMO-001',
    barcode: null,
    name: 'Demo Widget A',
    price: 29.99,
    categoryName: 'Widgets',
    description: 'A demonstration product — replace with real Erply data',
    imageUrl: null,
    stockQty: 42,
    isActive: true,
  },
  {
    sku: 'DEMO-002',
    barcode: null,
    name: 'Demo Gadget B',
    price: 59.99,
    categoryName: 'Gadgets',
    description: 'Another demo product',
    imageUrl: null,
    stockQty: 8,
    isActive: true,
  },
  {
    sku: 'DEMO-003',
    barcode: null,
    name: 'Demo Part C',
    price: 9.99,
    categoryName: 'Parts',
    description: '',
    imageUrl: null,
    stockQty: 0,
    isActive: true,
  },
]
