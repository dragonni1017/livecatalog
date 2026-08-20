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

export interface SalesOrderLine {
  qbItemListId: string
  desc: string
  qty: number
  rateCents: number
}

export function buildSalesOrderAddRq(args: {
  qbCustomerListId: string
  refNumber: string
  poNumber?: string | null
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

  const poXml = args.poNumber ? `\n    <PONumber>${xmlEscape(args.poNumber)}</PONumber>` : ''

  return wrapQbxml(`<SalesOrderAddRq requestID="1">
  <SalesOrderAdd>
    <CustomerRef><ListID>${xmlEscape(args.qbCustomerListId)}</ListID></CustomerRef>
    <RefNumber>${xmlEscape(args.refNumber)}</RefNumber>${poXml}${lineXml}
  </SalesOrderAdd>
</SalesOrderAddRq>`)
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
