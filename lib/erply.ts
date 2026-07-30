/**
 * Erply API client
 *
 * Stub mode: runs when ERPLY_CLIENT_CODE is not set — returns sample data so
 * the cron and sync routes work end-to-end before credentials are available.
 *
 * To activate real mode: set ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
 * in your Vercel environment variables and remove the stub guard in getSessionKey().
 */

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
    price: p.price ?? p.netPrice ?? 0,
    categoryName: p.groupName ?? '',
    description: p.description ?? '',
    imageUrl: primaryImage?.fullURL ?? primaryImage?.largeURL ?? null,
    stockQty,
    isActive: p.active === 1,
  }
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
