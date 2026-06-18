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
  images: Array<{ largeURL: string; isPrimary: 0 | 1 }>
  /** Included when getStockInfo=1 is passed */
  amountInStock?: number
  reservedAmount?: number
}

/** Shape of one record from Erply's getProductStock call */
interface ErplyStockRecord {
  productID: number
  amountInStock: number
  reservedAmount: number
  /** amountInStock - reservedAmount */
  free: number
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

function isConfigured(): boolean {
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
  const totalPages = Math.ceil(first.total / PAGE_SIZE)

  // Fetch remaining pages in sequence (Erply rate-limits aggressive parallel calls)
  for (let page = 2; page <= totalPages; page++) {
    const { products } = await fetchProductPage(sessionKey, page)
    allRaw.push(...products)
  }

  return allRaw.map(normalizeProduct)
}

function normalizeProduct(p: ErplyProduct): ErplySyncProduct {
  const primaryImage = p.images?.find((img) => img.isPrimary === 1) ?? p.images?.[0]
  return {
    sku: (p.code || String(p.productID)).trim(),
    barcode: p.code2?.trim() || null,
    name: p.name,
    price: p.price ?? p.netPrice ?? 0,
    categoryName: p.groupName ?? '',
    description: p.description ?? '',
    imageUrl: primaryImage?.largeURL ?? null,
    stockQty: p.amountInStock ?? 0,
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
