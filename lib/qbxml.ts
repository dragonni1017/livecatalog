/**
 * qbXML request builders + response parsers for the QuickBooks Web
 * Connector integration. Pure functions — no I/O, no DB, no fetch — so they
 * can be unit-tested against fixture XML without a live QBWC/QuickBooks
 * Desktop connection. See app/api/qbwc/route.ts for the SOAP layer that
 * calls these, and docs/memory/project-rep-price-tier-and-qbwc-plan.md for
 * the wider design.
 *
 * Field-mapping assumptions baked into these builders — verify against the
 * real company file once hardware testing starts:
 *  - CustomerQueryRq has no email filter (only Name/ListID), so customer
 *    lookup is by name (order_requests.customer_company, falling back to
 *    customer_name), not email. Our own qb_customer_links table is still
 *    keyed by email (our join key) — it's just populated via this
 *    name-based QuickBooks-side lookup.
 *  - QuickBooks item "Name" is assumed to equal our products.sku.
 *  - Auto-created items (buildItemAddRq) are sale-only (SalesOrPurchase, not
 *    SalesAndPurchase — the latter needs a separate expense account too)
 *    and post to a hardcoded Income Account name (QB_INCOME_ACCOUNT_NAME in
 *    app/api/qbwc/route.ts) that must exist in the target company file's
 *    Chart of Accounts — verify/update it before pointing this at a
 *    different company file.
 */
import { XMLParser } from 'fast-xml-parser'

const QBXML_VERSION = '13.0'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

export function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapQbxml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<?qbxml version="${QBXML_VERSION}"?>\n` +
    `<QBXML>\n<QBXMLMsgsRq onError="stopOnError">\n${bodyXml}\n</QBXMLMsgsRq>\n</QBXML>`
  )
}

// ── Request builders ────────────────────────────────────────────────────

export function buildCustomerQueryRq(name: string): string {
  return wrapQbxml(`<CustomerQueryRq requestID="1"><FullName>${xmlEscape(name)}</FullName></CustomerQueryRq>`)
}

export function buildItemQueryRq(sku: string): string {
  return wrapQbxml(`<ItemQueryRq requestID="1"><FullName>${xmlEscape(sku)}</FullName></ItemQueryRq>`)
}

// Unfiltered CustomerQueryRq (no <FullName> filter) — pulls QuickBooks'
// entire existing customer list, paged via the iterator protocol: the first
// call uses iterator="Start"; the response carries an iteratorID and an
// iteratorRemainingCount attribute on CustomerQueryRs (see
// parseCustomerFullQueryRs) — if remaining > 0, the next call passes that
// same iteratorID back with iterator="Continue" to resume where it left off.
export function buildCustomerFullQueryRq(args: {
  iterator: 'Start' | 'Continue'
  iteratorID?: string | null
  maxReturned?: number
}): string {
  const iterAttr =
    args.iterator === 'Continue' && args.iteratorID
      ? ` iterator="Continue" iteratorID="${xmlEscape(args.iteratorID)}"`
      : ` iterator="Start"`
  const maxReturnedXml = args.maxReturned ? `<MaxReturned>${args.maxReturned}</MaxReturned>` : ''
  return wrapQbxml(`<CustomerQueryRq requestID="1"${iterAttr}>${maxReturnedXml}</CustomerQueryRq>`)
}

// Unfiltered ItemQueryRq — the item-list counterpart of
// buildCustomerFullQueryRq, using the identical iterator protocol. Used to
// mirror QuickBooks' item list into qb_item_directory so a SKU arriving on a
// container can be named from the record Dragon typed in QuickBooks.
//
// ActiveStatus defaults to ActiveOnly; "All" is passed explicitly so a
// deliberately inactive item still comes back — it's the discontinued ones
// you most want to recognise rather than silently re-create.
export function buildItemFullQueryRq(args: {
  iterator: 'Start' | 'Continue'
  iteratorID?: string | null
  maxReturned?: number
}): string {
  const iterAttr =
    args.iterator === 'Continue' && args.iteratorID
      ? ` iterator="Continue" iteratorID="${xmlEscape(args.iteratorID)}"`
      : ` iterator="Start"`
  const maxReturnedXml = args.maxReturned ? `<MaxReturned>${args.maxReturned}</MaxReturned>` : ''
  return wrapQbxml(
    `<ItemQueryRq requestID="1"${iterAttr}>${maxReturnedXml}<ActiveStatus>All</ActiveStatus></ItemQueryRq>`,
  )
}

// A name-filtered CustomerQueryRq/ItemQueryRq that finds nothing returns
// statusCode 500 (statusSeverity "Warn"), not an empty success result — the
// signal callers use to fall back to CustomerAddRq/ItemNonInventoryAddRq
// instead of treating it as a real lookup failure.
export function isNotFoundStatus(status: QbxmlStatus): boolean {
  return status.code === 500
}

// Phone/Email are simple optional CustomerAdd children, in schema order
// (Phone before Email) directly after Name -- there's no address data
// anywhere in this app's order model to populate BillAddress/ShipAddress.
export function buildCustomerAddRq(name: string, phone?: string | null, email?: string | null): string {
  const phoneXml = phone ? `<Phone>${xmlEscape(phone)}</Phone>` : ''
  const emailXml = email ? `<Email>${xmlEscape(email)}</Email>` : ''
  return wrapQbxml(
    `<CustomerAddRq requestID="1"><CustomerAdd><Name>${xmlEscape(name)}</Name>${phoneXml}${emailXml}</CustomerAdd></CustomerAddRq>`,
  )
}

// Non-inventory part — no quantity/inventory tracking, just a sellable line
// item. SalesOrPurchase (not SalesAndPurchase — that variant is for items
// both bought AND sold and requires a separate expense account too) is the
// single-sided "we only sell this" form; its AccountRef must match an
// existing Income account in the QuickBooks company file's Chart of
// Accounts (varies per company — passed in rather than hardcoded).
export function buildItemAddRq(sku: string, incomeAccountName: string): string {
  return wrapQbxml(`<ItemNonInventoryAddRq requestID="1">
  <ItemNonInventoryAdd>
    <Name>${xmlEscape(sku)}</Name>
    <SalesOrPurchase>
      <AccountRef><FullName>${xmlEscape(incomeAccountName)}</FullName></AccountRef>
    </SalesOrPurchase>
  </ItemNonInventoryAdd>
</ItemNonInventoryAddRq>`)
}

export interface SalesOrderLine {
  qbItemListId: string
  desc: string
  qty: number
  rateCents: number
}

export interface QbAddress {
  addr1: string
  addr2?: string | null
  city: string
  state: string
  zip: string
  country?: string | null
}

function buildAddressXml(tag: string, addr: QbAddress): string {
  const addr2Xml = addr.addr2 ? `\n      <Addr2>${xmlEscape(addr.addr2)}</Addr2>` : ''
  const countryXml = addr.country ? `\n      <Country>${xmlEscape(addr.country)}</Country>` : ''
  return `\n    <${tag}>
      <Addr1>${xmlEscape(addr.addr1)}</Addr1>${addr2Xml}
      <City>${xmlEscape(addr.city)}</City>
      <State>${xmlEscape(addr.state)}</State>
      <PostalCode>${xmlEscape(addr.zip)}</PostalCode>${countryXml}
    </${tag}>`
}

// RefNumber is deliberately NEVER sent -- omitting it lets QuickBooks assign
// its own auto-incrementing Sales Order number instead of us overwriting it
// (Dragon's explicit call 2026-08-31: keep PONumber, drop RefNumber). The
// full reference code still lives in Memo (and PONumber, as a fallback) for
// traceability -- see compactRefNumber below, now only used by
// fallbackPoNumber's own length cap, not for RefNumber.
//
// Element order below (CustomerRef, ShipAddress, PONumber, Memo, then line
// items) matches qbXML's SalesOrderAdd OSR schema order exactly — QuickBooks
// rejects out-of-order elements, it's not just cosmetic.
export function buildSalesOrderAddRq(args: {
  qbCustomerListId: string
  memo: string
  poNumber?: string | null
  shipAddress?: QbAddress | null
  lines: SalesOrderLine[]
}): string {
  const lineXml = args.lines
    .map(
      (l) => `
    <SalesOrderLineAdd>
      <ItemRef><ListID>${xmlEscape(l.qbItemListId)}</ListID></ItemRef>
      <Desc>${xmlEscape(l.desc)}</Desc>
      <Quantity>${l.qty}</Quantity>
      <Rate>${(l.rateCents / 100).toFixed(2)}</Rate>
    </SalesOrderLineAdd>`,
    )
    .join('')

  const shipXml = args.shipAddress ? buildAddressXml('ShipAddress', args.shipAddress) : ''
  const poXml = args.poNumber ? `\n    <PONumber>${xmlEscape(args.poNumber)}</PONumber>` : ''

  return wrapQbxml(`<SalesOrderAddRq requestID="1">
  <SalesOrderAdd>
    <CustomerRef><ListID>${xmlEscape(args.qbCustomerListId)}</ListID></CustomerRef>${shipXml}${poXml}
    <Memo>${xmlEscape(args.memo)}</Memo>${lineXml}
  </SalesOrderAdd>
</SalesOrderAddRq>`)
}

// Compacts a reference code (e.g. "ORD-2026-WHO-0011") to fit within 11
// characters: drops the constant "ORD-<year>-" portion, keeping just
// "<tier>-<seq>" (e.g. "WHO-0011") or, for a non-rep order with no tier,
// just "<seq>" (e.g. "0012"). No longer used for QuickBooks' RefNumber
// (see buildSalesOrderAddRq -- that's deliberately never sent, so
// QuickBooks can assign its own auto-incrementing S.O. number) -- only
// remaining caller is fallbackPoNumber's own length cap below. Kept at 11
// chars rather than PONumber's own 25-char cap so it stays valid for
// either use.
export function compactRefNumber(referenceCode: string): string {
  const parts = referenceCode.split('-')
  const seq = parts[parts.length - 1]
  const tierParts = parts.slice(2, -1)
  const compact = tierParts.length ? `${tierParts.join('-')}-${seq}` : seq
  return compact.slice(0, 11)
}

// QuickBooks' PO Numbers field caps at 25 characters (confirmed via
// Intuit's documented QuickBooks Desktop field-length table). Used when an
// order has no real customer-supplied PO number — the full reference code
// fits well within 25 for the current format, but falls back to the same
// compact tier-<seq> form as compactRefNumber if it ever doesn't.
export const QB_PO_NUMBER_MAX_CHARS = 25

export function fallbackPoNumber(referenceCode: string): string {
  return referenceCode.length <= QB_PO_NUMBER_MAX_CHARS ? referenceCode : compactRefNumber(referenceCode)
}

// ── Response parsers ─────────────────────────────────────────────────────
// Every qbXML *Rs element carries statusCode/statusSeverity/statusMessage as
// attributes (statusCode="0" = success) -- this convention is stable across
// all qbXML response types.

export interface QbxmlStatus {
  code: number
  severity: string
  message: string
  ok: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readStatus(rsNode: any): QbxmlStatus {
  const code = Number(rsNode?.['@_statusCode'])
  return {
    code: Number.isFinite(code) ? code : -1,
    severity: String(rsNode?.['@_statusSeverity'] ?? ''),
    message: String(rsNode?.['@_statusMessage'] ?? ''),
    ok: code === 0,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstRsNode(xml: string, rsTag: string): any {
  const doc = parser.parse(xml)
  const node = doc?.QBXML?.QBXMLMsgsRs?.[rsTag]
  return Array.isArray(node) ? node[0] : node
}

export interface QbxmlLookupResult {
  status: QbxmlStatus
  listId?: string
  fullName?: string
}

export function parseCustomerQueryRs(xml: string): QbxmlLookupResult {
  const rs = firstRsNode(xml, 'CustomerQueryRs')
  const status = readStatus(rs)
  if (!status.ok) return { status }
  const ret = Array.isArray(rs?.CustomerRet) ? rs.CustomerRet[0] : rs?.CustomerRet
  return { status, listId: ret?.ListID, fullName: ret?.FullName }
}

export interface QbCustomerDirectoryEntry {
  listId: string
  fullName: string
  companyName?: string
  email?: string
  phone?: string
}

export interface CustomerFullQueryResult {
  status: QbxmlStatus
  customers: QbCustomerDirectoryEntry[]
  // Present only while more pages remain — see buildCustomerFullQueryRq.
  iteratorId?: string
  remainingCount?: number
}

export function parseCustomerFullQueryRs(xml: string): CustomerFullQueryResult {
  const rs = firstRsNode(xml, 'CustomerQueryRs')
  const status = readStatus(rs)
  if (!status.ok) return { status, customers: [] }

  const rawRets = rs?.CustomerRet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rets: any[] = Array.isArray(rawRets) ? rawRets : rawRets ? [rawRets] : []
  const customers: QbCustomerDirectoryEntry[] = rets
    .filter((r) => r?.ListID && r?.FullName)
    .map((r) => ({
      listId: String(r.ListID),
      fullName: String(r.FullName),
      companyName: r.CompanyName ? String(r.CompanyName) : undefined,
      email: r.Email ? String(r.Email) : undefined,
      phone: r.Phone ? String(r.Phone) : undefined,
    }))

  const iteratorId = rs?.['@_iteratorID'] ? String(rs['@_iteratorID']) : undefined
  const remainingRaw = rs?.['@_iteratorRemainingCount']
  const remainingCount = remainingRaw !== undefined ? Number(remainingRaw) : undefined

  return { status, customers, iteratorId, remainingCount }
}

export interface QbItemDirectoryEntry {
  listId: string
  /** QuickBooks' FullName verbatim — "Parent:Child" for a sub-item. */
  fullName: string
  /** Last ":"-separated segment of fullName, which is the real SKU. */
  sku: string
  salesDesc?: string
  /** 'Inventory' | 'NonInventory' | 'Service' | 'InventoryAssembly' | … */
  itemType?: string
  salesPrice?: number
  isActive?: boolean
}

export interface ItemFullQueryResult {
  status: QbxmlStatus
  items: QbItemDirectoryEntry[]
  iteratorId?: string
  remainingCount?: number
}

/**
 * "Backpack:F286716" -> "F286716".
 *
 * QuickBooks sub-items carry their parent in FullName. A QBD Item List
 * export needed exactly this stripped off 813 rows before it would match the
 * catalog (scripts/fix-fullqbd-sku-prefixes.mjs), so the pull does it once
 * here rather than leaving every consumer to rediscover it.
 */
export function skuFromItemFullName(fullName: string): string {
  const parts = String(fullName).split(':')
  return (parts[parts.length - 1] ?? '').trim()
}

/**
 * Parses one page of an unfiltered ItemQueryRq.
 *
 * Unlike CustomerQueryRs, which only ever returns CustomerRet, an item query
 * returns a DIFFERENT element per item type — ItemInventoryRet,
 * ItemNonInventoryRet, ItemServiceRet, ItemInventoryAssemblyRet,
 * ItemOtherChargeRet and so on — so every *Ret key is collected rather than
 * one being assumed (the same reasoning as parseItemQueryRs, which already
 * had to search for the key).
 *
 * The description also moves: inventory items carry SalesDesc directly,
 * while non-inventory and service items nest it under SalesOrPurchase (or
 * SalesAndPurchase for items both bought and sold). All three are
 * normalised to salesDesc, because a caller naming a SKU does not care which
 * QuickBooks item type it happens to be.
 */
export function parseItemFullQueryRs(xml: string): ItemFullQueryResult {
  const rs = firstRsNode(xml, 'ItemQueryRs')
  const status = readStatus(rs)
  if (!status.ok) return { status, items: [] }

  const items: QbItemDirectoryEntry[] = []
  for (const key of rs ? Object.keys(rs) : []) {
    if (!key.endsWith('Ret')) continue
    // "ItemNonInventoryRet" -> "NonInventory"
    const itemType = key.replace(/^Item/, '').replace(/Ret$/, '') || undefined
    const raw = rs[key]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rets: any[] = Array.isArray(raw) ? raw : raw ? [raw] : []
    for (const r of rets) {
      if (!r?.ListID || !r?.FullName) continue
      const sop = r.SalesOrPurchase ?? r.SalesAndPurchase
      const desc = r.SalesDesc ?? sop?.Desc
      const priceRaw = r.SalesPrice ?? sop?.Price
      const price = priceRaw !== undefined && priceRaw !== null ? Number(priceRaw) : undefined
      items.push({
        listId: String(r.ListID),
        fullName: String(r.FullName),
        sku: skuFromItemFullName(String(r.FullName)),
        salesDesc: desc ? String(desc) : undefined,
        itemType,
        salesPrice: Number.isFinite(price) ? price : undefined,
        isActive: r.IsActive === undefined ? undefined : String(r.IsActive) === 'true',
      })
    }
  }

  const iteratorId = rs?.['@_iteratorID'] ? String(rs['@_iteratorID']) : undefined
  const remainingRaw = rs?.['@_iteratorRemainingCount']
  const remainingCount = remainingRaw !== undefined ? Number(remainingRaw) : undefined

  return { status, items, iteratorId, remainingCount }
}

export function parseItemQueryRs(xml: string): QbxmlLookupResult {
  const rs = firstRsNode(xml, 'ItemQueryRs')
  const status = readStatus(rs)
  if (!status.ok) return { status }
  // Item type varies by QuickBooks item type (ItemInventoryRet,
  // ItemServiceRet, ItemNonInventoryRet, ...) -- find whichever *Ret key is
  // actually present rather than assuming one specific element name.
  const retKey = rs ? Object.keys(rs).find((k) => k.endsWith('Ret')) : undefined
  const retRaw = retKey ? rs[retKey] : undefined
  const ret = Array.isArray(retRaw) ? retRaw[0] : retRaw
  return { status, listId: ret?.ListID, fullName: ret?.FullName }
}

export function parseCustomerAddRs(xml: string): QbxmlLookupResult {
  const rs = firstRsNode(xml, 'CustomerAddRs')
  const status = readStatus(rs)
  if (!status.ok) return { status }
  return { status, listId: rs?.CustomerRet?.ListID, fullName: rs?.CustomerRet?.FullName }
}

export function parseItemAddRs(xml: string): QbxmlLookupResult {
  const rs = firstRsNode(xml, 'ItemNonInventoryAddRs')
  const status = readStatus(rs)
  if (!status.ok) return { status }
  return { status, listId: rs?.ItemNonInventoryRet?.ListID, fullName: rs?.ItemNonInventoryRet?.FullName }
}

export interface SalesOrderAddResult {
  status: QbxmlStatus
  txnId?: string
}

export function parseSalesOrderAddRs(xml: string): SalesOrderAddResult {
  const rs = firstRsNode(xml, 'SalesOrderAddRs')
  const status = readStatus(rs)
  if (!status.ok) return { status }
  return { status, txnId: rs?.SalesOrderRet?.TxnID }
}
