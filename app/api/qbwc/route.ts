import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { XMLParser } from 'fast-xml-parser'
import { getAdminClient } from '@/lib/supabase'
import {
  buildCustomerQueryRq,
  buildItemQueryRq,
  buildSalesOrderAddRq,
  parseCustomerQueryRs,
  parseItemQueryRs,
  parseSalesOrderAddRs,
  xmlEscape,
  type SalesOrderLine,
} from '@/lib/qbxml'

export const dynamic = 'force-dynamic'

// SOAP endpoint for Intuit's QuickBooks Web Connector (QBWC) — a Windows
// service on the machine running QuickBooks Desktop that polls this
// endpoint on a schedule and exchanges qbXML to create Sales Orders. QB
// Desktop has no cloud API, so this SOAP round trip is the only integration
// path. Deliberately at the top level (not under /admin) so it's excluded
// from the admin-cookie middleware gate — QBWC is a headless SOAP client
// with no browser session, and authenticates itself via QBWC_USERNAME/
// QBWC_PASSWORD inside authenticate() below, per the QBWC protocol.
//
// Session/conversation state (the ticket from authenticate(), and what the
// most recent sendRequestXML asked QuickBooks for) is stored in
// qb_sessions rather than in memory — this runs on Vercel serverless
// functions, and an in-memory ticket map would not survive cold starts or
// concurrent invocations. See supabase/migrations/0031_qbwc_sync.sql and
// docs/memory/project-rep-price-tier-and-qbwc-plan.md for the full design.

const NS = 'http://developer.intuit.com/'
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true })

type Db = ReturnType<typeof getAdminClient>

function soapEnvelope(bodyInnerXml: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n` +
    `<soap:Body>\n${bodyInnerXml}\n</soap:Body>\n</soap:Envelope>`
  )
}

function simpleResult(op: string, resultTag: string, value: string): string {
  return soapEnvelope(`<${op}Response xmlns="${NS}"><${resultTag}>${value}</${resultTag}></${op}Response>`)
}

function authenticateResult(ticket: string, second: string): string {
  return soapEnvelope(
    `<authenticateResponse xmlns="${NS}"><authenticateResult><string>${xmlEscape(ticket)}</string><string>${xmlEscape(second)}</string></authenticateResult></authenticateResponse>`,
  )
}

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const bodyXml = await request.text()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any
  try {
    doc = parser.parse(bodyXml)
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const soapBody = doc?.Envelope?.Body
  const opName = soapBody ? Object.keys(soapBody).find((k) => k !== '@_') : undefined
  if (!soapBody || !opName) return new NextResponse('Bad Request', { status: 400 })
  const params = soapBody[opName] ?? {}

  const db = getAdminClient()

  switch (opName) {
    case 'serverVersion':
      return xmlResponse(simpleResult('serverVersion', 'serverVersionResult', '1.0'))
    case 'clientVersion':
      // Empty string accepts any client version.
      return xmlResponse(simpleResult('clientVersion', 'clientVersionResult', ''))
    case 'authenticate':
      return xmlResponse(await handleAuthenticate(db, params))
    case 'sendRequestXML':
      return xmlResponse(await handleSendRequestXML(db, params))
    case 'receiveResponseXML':
      return xmlResponse(await handleReceiveResponseXML(db, params))
    case 'connectionError':
      return xmlResponse(await handleConnectionError(db, params))
    case 'getLastError':
      return xmlResponse(await handleGetLastError(db))
    case 'closeConnection':
      return xmlResponse(await handleCloseConnection(db, params))
    default:
      return new NextResponse('Not Implemented', { status: 501 })
  }
}

// ── Session / link helpers ──────────────────────────────────────────────

interface QbSession {
  ticket: string
  pending_request_kind: 'customer_query' | 'item_query' | 'sales_order_add' | null
  pending_order_id: string | null
  pending_ref: string | null
}

async function getSession(db: Db, ticket: string): Promise<QbSession | null> {
  if (!ticket) return null
  const { data } = await db.from('qb_sessions').select('*').eq('ticket', ticket).maybeSingle()
  return data as QbSession | null
}

async function setPending(db: Db, ticket: string, kind: QbSession['pending_request_kind'], orderId: string, ref: string) {
  await db
    .from('qb_sessions')
    .update({ pending_request_kind: kind, pending_order_id: orderId, pending_ref: ref })
    .eq('ticket', ticket)
}

async function clearPending(db: Db, ticket: string) {
  await db
    .from('qb_sessions')
    .update({ pending_request_kind: null, pending_order_id: null, pending_ref: null })
    .eq('ticket', ticket)
}

async function markQueueError(db: Db, orderId: string, message: string, responseXml?: string) {
  await db
    .from('qb_sync_queue')
    .update({
      status: 'error',
      error_message: message,
      ...(responseXml ? { qbxml_response: responseXml } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('order_id', orderId)
}

// ── Operation handlers ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleAuthenticate(db: Db, params: any): Promise<string> {
  const username = String(params.strUserName ?? '')
  const password = String(params.strPassword ?? '')
  const expectedUser = process.env.QBWC_USERNAME
  const expectedPass = process.env.QBWC_PASSWORD

  if (!expectedUser || !expectedPass || username !== expectedUser || password !== expectedPass) {
    return authenticateResult('', 'nvu') // "nvu" = not a valid user, per the QBWC protocol
  }

  const ticket = randomUUID()
  const { error: insertError } = await db.from('qb_sessions').insert({ ticket })
  if (insertError) {
    // Handing QBWC a ticket that doesn't actually exist in qb_sessions would
    // silently break every subsequent call in this conversation (getSession
    // would just return null) — fail the handshake instead so QBWC surfaces
    // a real error rather than polling a dead session.
    console.error('[qbwc] failed to open session:', insertError.message)
    return authenticateResult('', 'nvu')
  }
  return authenticateResult(ticket, '') // '' = use the currently open company file
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSendRequestXML(db: Db, params: any): Promise<string> {
  const ticket = String(params.ticket ?? '')
  const session = await getSession(db, ticket)
  if (!session) return simpleResult('sendRequestXML', 'sendRequestXMLResult', '')

  const { data: queueRow } = await db
    .from('qb_sync_queue')
    .select('id, order_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // Empty string signals "no more requests" — QBWC ends the session here.
  if (!queueRow) return simpleResult('sendRequestXML', 'sendRequestXMLResult', '')

  const { data: order, error: orderError } = await db
    .from('order_requests')
    .select('id, reference_code, customer_name, customer_company, customer_email, po_number')
    .eq('id', queueRow.order_id)
    .single()
  const { data: items, error: itemsError } = await db
    .from('order_items')
    .select('sku, name, qty, line_total_cents')
    .eq('order_id', queueRow.order_id)

  if (!order || !items || items.length === 0) {
    // Distinguish a real DB/query error (transient, worth a distinct
    // message so it's not confused with a genuine data-integrity gap) from
    // an order that legitimately has no items — either way, error this row
    // out rather than looping on it every poll; the next poll picks the
    // next row.
    const message = orderError || itemsError
      ? `Lookup failed: ${orderError?.message || itemsError?.message}`
      : 'Order or its line items were not found at sync time'
    await markQueueError(db, queueRow.order_id, message)
    return simpleResult('sendRequestXML', 'sendRequestXMLResult', '')
  }

  const qbName = (order.customer_company || order.customer_name || '').trim()

  const { data: customerLink } = await db
    .from('qb_customer_links')
    .select('qb_customer_list_id')
    .eq('email', order.customer_email)
    .maybeSingle()

  if (!customerLink?.qb_customer_list_id) {
    await setPending(db, ticket, 'customer_query', order.id, order.customer_email)
    return simpleResult('sendRequestXML', 'sendRequestXMLResult', xmlEscape(buildCustomerQueryRq(qbName)))
  }

  const itemLinks = new Map<string, string>()
  for (const item of items) {
    const { data: link } = await db
      .from('qb_item_links')
      .select('qb_item_list_id')
      .eq('sku', item.sku)
      .maybeSingle()
    if (!link?.qb_item_list_id) {
      await setPending(db, ticket, 'item_query', order.id, item.sku)
      return simpleResult('sendRequestXML', 'sendRequestXMLResult', xmlEscape(buildItemQueryRq(item.sku)))
    }
    itemLinks.set(item.sku, link.qb_item_list_id)
  }

  // Every link resolved — build and send the real SalesOrderAdd.
  const lines: SalesOrderLine[] = items.map((item) => ({
    qbItemListId: itemLinks.get(item.sku)!,
    desc: item.name,
    qty: item.qty,
    rateCents: Math.round(item.line_total_cents / item.qty),
  }))
  const xml = buildSalesOrderAddRq({
    qbCustomerListId: customerLink.qb_customer_list_id,
    refNumber: order.reference_code,
    poNumber: order.po_number,
    lines,
  })

  await db
    .from('qb_sync_queue')
    .update({ status: 'sent', qbxml_request: xml, attempt_count: 1, last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', queueRow.id)
  await setPending(db, ticket, 'sales_order_add', order.id, queueRow.id)

  return simpleResult('sendRequestXML', 'sendRequestXMLResult', xmlEscape(xml))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleReceiveResponseXML(db: Db, params: any): Promise<string> {
  const ticket = String(params.ticket ?? '')
  const responseXml = String(params.response ?? '')
  const session = await getSession(db, ticket)

  if (session?.pending_request_kind === 'customer_query' && session.pending_order_id && session.pending_ref) {
    const result = parseCustomerQueryRs(responseXml)
    if (result.status.ok && result.listId) {
      await db.from('qb_customer_links').upsert({
        email: session.pending_ref,
        qb_customer_list_id: result.listId,
        qb_customer_full_name: result.fullName ?? null,
        last_synced_at: new Date().toISOString(),
        last_sync_source: 'qbwc_pull',
      })
    } else {
      await markQueueError(db, session.pending_order_id, `Customer lookup failed: ${result.status.message || 'no match in QuickBooks'}`, responseXml)
    }
  } else if (session?.pending_request_kind === 'item_query' && session.pending_order_id && session.pending_ref) {
    const result = parseItemQueryRs(responseXml)
    if (result.status.ok && result.listId) {
      await db.from('qb_item_links').upsert({
        sku: session.pending_ref,
        qb_item_list_id: result.listId,
        qb_item_full_name: result.fullName ?? null,
        last_synced_at: new Date().toISOString(),
        last_sync_source: 'qbwc_pull',
      })
    } else {
      await markQueueError(db, session.pending_order_id, `Item lookup failed for SKU ${session.pending_ref}: ${result.status.message || 'no match in QuickBooks'}`, responseXml)
    }
  } else if (session?.pending_request_kind === 'sales_order_add' && session.pending_order_id) {
    const result = parseSalesOrderAddRs(responseXml)
    if (result.status.ok) {
      await db
        .from('qb_sync_queue')
        .update({ status: 'acked', qbxml_response: responseXml, updated_at: new Date().toISOString() })
        .eq('order_id', session.pending_order_id)
      await db
        .from('order_requests')
        .update({ entered_in_qb: true, entered_in_qb_at: new Date().toISOString() })
        .eq('id', session.pending_order_id)
    } else {
      await markQueueError(db, session.pending_order_id, result.status.message || 'SalesOrderAdd failed', responseXml)
    }
  }

  if (session) await clearPending(db, ticket)

  // Rough progress estimate for QBWC's UI only — not authoritative. The
  // session only actually ends when sendRequestXML next returns "".
  const { count: pendingCount } = await db
    .from('qb_sync_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  return simpleResult('receiveResponseXML', 'receiveResponseXMLResult', pendingCount ? '50' : '100')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleConnectionError(db: Db, params: any): Promise<string> {
  const ticket = String(params.ticket ?? '')
  const session = await getSession(db, ticket)
  if (session?.pending_order_id) {
    const detail = String(params.message ?? params.hresult ?? 'unknown')
    await markQueueError(db, session.pending_order_id, `QBWC connection error: ${detail}`)
  }
  // "done" aborts this session gracefully rather than retrying a different company file.
  return simpleResult('connectionError', 'connectionErrorResult', 'done')
}

async function handleGetLastError(db: Db): Promise<string> {
  const { data, error } = await db
    .from('qb_sync_queue')
    .select('error_message')
    .eq('status', 'error')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) console.error('[qbwc] getLastError query failed:', error.message)
  return simpleResult('getLastError', 'getLastErrorResult', xmlEscape(data?.error_message ?? ''))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCloseConnection(db: Db, params: any): Promise<string> {
  const ticket = String(params.ticket ?? '')
  await db.from('qb_sessions').update({ closed_at: new Date().toISOString() }).eq('ticket', ticket)
  return simpleResult('closeConnection', 'closeConnectionResult', 'OK')
}
