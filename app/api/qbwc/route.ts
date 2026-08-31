import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { XMLParser } from 'fast-xml-parser'
import { getAdminClient } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import {
  buildCustomerAddRq,
  buildCustomerFullQueryRq,
  buildCustomerQueryRq,
  buildItemAddRq,
  buildItemQueryRq,
  buildSalesOrderAddRq,
  compactRefNumber,
  fallbackPoNumber,
  isNotFoundStatus,
  parseCustomerAddRs,
  parseCustomerFullQueryRs,
  parseCustomerQueryRs,
  parseItemAddRs,
  parseItemQueryRs,
  parseSalesOrderAddRs,
  xmlEscape,
  type SalesOrderLine,
} from '@/lib/qbxml'

const CUSTOMER_PULL_PAGE_SIZE = 100

// Income account new auto-created items post to (SalesAndPurchase/
// IncomeAccountRef in buildItemAddRq) — must exactly match an account name
// in the target QuickBooks company file's Chart of Accounts. Update this if
// pointing at a company file where that account is named differently.
const QB_INCOME_ACCOUNT_NAME = 'Revenue'

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

// Before adding the app, QBWC does a plain GET against AppURL just to check
// the TLS cert is valid — unrelated to the real SOAP POST traffic below. A
// 405 on that GET makes QBWC report the (misleading) QBWC1048 "could not
// verify certificate" error, so this has to return 200 to something, not
// reject non-POST requests.
export async function GET(): Promise<NextResponse> {
  return new NextResponse('QBWC SOAP endpoint', { status: 200 })
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

type PendingRequestKind =
  | 'customer_query'
  | 'customer_add'
  | 'item_query'
  | 'item_add'
  | 'sales_order_add'
  // Not tied to a single order — pending_order_id/pending_ref stay null;
  // continuation state (the iterator) lives in qb_customer_pull_state
  // instead, since it must survive across separate authenticate() tickets.
  | 'customer_full_query'

interface QbSession {
  ticket: string
  pending_request_kind: PendingRequestKind | null
  pending_order_id: string | null
  pending_ref: string | null
}

async function getSession(db: Db, ticket: string): Promise<QbSession | null> {
  if (!ticket) return null
  const { data } = await db.from('qb_sessions').select('*').eq('ticket', ticket).maybeSingle()
  return data as QbSession | null
}

async function setPending(
  db: Db,
  ticket: string,
  kind: PendingRequestKind,
  orderId: string | null,
  ref: string | null,
) {
  await db
    .from('qb_sessions')
    .update({ pending_request_kind: kind, pending_order_id: orderId, pending_ref: ref })
    .eq('ticket', ticket)
}

interface QbCustomerPullState {
  status: 'idle' | 'requested' | 'in_progress' | 'done' | 'error'
  iterator_id: string | null
  pulled_count: number
}

async function getCustomerPullState(db: Db): Promise<QbCustomerPullState | null> {
  const { data } = await db
    .from('qb_customer_pull_state')
    .select('status, iterator_id, pulled_count')
    .eq('id', 1)
    .maybeSingle()
  return data as QbCustomerPullState | null
}

async function updateCustomerPullState(db: Db, patch: Record<string, unknown>) {
  await db
    .from('qb_customer_pull_state')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1)
}

function buildCustomerPullRequest(pull: { iterator_id: string | null }): string {
  return pull.iterator_id
    ? buildCustomerFullQueryRq({ iterator: 'Continue', iteratorID: pull.iterator_id, maxReturned: CUSTOMER_PULL_PAGE_SIZE })
    : buildCustomerFullQueryRq({ iterator: 'Start', maxReturned: CUSTOMER_PULL_PAGE_SIZE })
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

  // A failed sync means this order never actually made it into QuickBooks --
  // revert the "Converted" mark so it doesn't sit in the admin orders list
  // looking approved when it isn't. Written directly here (not through
  // /admin/api/orders' PATCH) so this can never re-trigger that endpoint's
  // customer status-change email or stock-decrement side effects — only
  // revert if it's still 'converted' (admin may have already moved it
  // elsewhere in the meantime).
  const { data: order } = await db
    .from('order_requests')
    .select('status, reference_code')
    .eq('id', orderId)
    .maybeSingle()
  if (order?.status === 'converted') {
    await db
      .from('order_requests')
      .update({
        status: 'new',
        status_changed_by: 'QuickBooks sync (auto-reverted after failure)',
        status_changed_at: new Date().toISOString(),
      })
      .eq('id', orderId)
    await logAudit({
      action: 'order_qb_sync_failed_reverted',
      entity_type: 'order',
      entity_id: orderId,
      entity_label: order.reference_code,
      old_value: 'converted',
      new_value: 'new',
    })
  }
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

  // A prior query in this same lookup round found no match — send the
  // corresponding Add request instead of re-running the queue/link
  // resolution below (the queue row stays 'pending' throughout this whole
  // lookup phase, so re-entering that logic here would just re-query).
  if (session.pending_request_kind === 'customer_add' && session.pending_order_id) {
    const { data: order } = await db
      .from('order_requests')
      .select('customer_name, customer_company, customer_phone, customer_email')
      .eq('id', session.pending_order_id)
      .single()
    const qbName = (order?.customer_company || order?.customer_name || '').trim()
    return simpleResult(
      'sendRequestXML',
      'sendRequestXMLResult',
      xmlEscape(buildCustomerAddRq(qbName, order?.customer_phone, order?.customer_email)),
    )
  }
  if (session.pending_request_kind === 'item_add' && session.pending_ref) {
    return simpleResult(
      'sendRequestXML',
      'sendRequestXMLResult',
      xmlEscape(buildItemAddRq(session.pending_ref, QB_INCOME_ACCOUNT_NAME)),
    )
  }

  // Continue an admin-triggered full customer-list pull already in progress
  // in this same session (see receiveResponseXML's customer_full_query
  // branch). Runs to completion (across as many sendRequestXML/
  // receiveResponseXML round trips as QuickBooks' iterator needs) before any
  // per-order sync work below, since it's a rare, admin-initiated operation
  // rather than routine traffic.
  if (session.pending_request_kind === 'customer_full_query') {
    const pull = await getCustomerPullState(db)
    if (pull && pull.status === 'in_progress') {
      return simpleResult('sendRequestXML', 'sendRequestXMLResult', xmlEscape(buildCustomerPullRequest(pull)))
    }
    await clearPending(db, ticket)
  } else if (!session.pending_request_kind) {
    // Not mid any other flow — check whether admin has requested a pull.
    const pull = await getCustomerPullState(db)
    if (pull && (pull.status === 'requested' || pull.status === 'in_progress')) {
      if (pull.status === 'requested') await updateCustomerPullState(db, { status: 'in_progress' })
      await setPending(db, ticket, 'customer_full_query', null, null)
      return simpleResult('sendRequestXML', 'sendRequestXMLResult', xmlEscape(buildCustomerPullRequest(pull)))
    }
  }

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
    .select('id, reference_code, customer_name, customer_company, customer_email, po_number, notes, ship_address1, ship_address2, ship_city, ship_state, ship_zip, ship_country')
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

  // Every link resolved — build and send the real SalesOrderAdd. Some items
  // have QuickBooks' own Advanced Unit of Measure configured (seen live on
  // main, not the temp file it was originally tested against) -- QuickBooks
  // silently substitutes its own on-file rate for those, ignoring whatever
  // <Rate> we send. Rather than fight that, the actual charged price is
  // appended to the line Desc so it stays visible on the document even when
  // QuickBooks' own Rate/Amount differ from it.
  const lines: SalesOrderLine[] = items.map((item) => {
    const rateCents = Math.round(item.line_total_cents / item.qty)
    return {
      qbItemListId: itemLinks.get(item.sku)!,
      desc: `${item.name} (ordered @ $${(rateCents / 100).toFixed(2)}/ea)`,
      qty: item.qty,
      rateCents,
    }
  })
  const xml = buildSalesOrderAddRq({
    qbCustomerListId: customerLink.qb_customer_list_id,
    refNumber: compactRefNumber(order.reference_code),
    memo: order.notes ? `${order.reference_code}\n${order.notes}` : order.reference_code,
    poNumber: order.po_number || fallbackPoNumber(order.reference_code),
    shipAddress: order.ship_address1
      ? {
          addr1: order.ship_address1,
          addr2: order.ship_address2,
          city: order.ship_city ?? '',
          state: order.ship_state ?? '',
          zip: order.ship_zip ?? '',
          country: order.ship_country,
        }
      : null,
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

  // Set false only when transitioning into an Add state — that leaves the
  // session's pending_order_id/pending_ref in place so the next
  // sendRequestXML call (see the short-circuit above) knows what to add.
  let shouldClearPending = true

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
    } else if (isNotFoundStatus(result.status)) {
      await setPending(db, ticket, 'customer_add', session.pending_order_id, session.pending_ref)
      shouldClearPending = false
    } else {
      await markQueueError(db, session.pending_order_id, `Customer lookup failed: ${result.status.message || 'no match in QuickBooks'}`, responseXml)
    }
  } else if (session?.pending_request_kind === 'customer_add' && session.pending_order_id && session.pending_ref) {
    const result = parseCustomerAddRs(responseXml)
    if (result.status.ok && result.listId) {
      await db.from('qb_customer_links').upsert({
        email: session.pending_ref,
        qb_customer_list_id: result.listId,
        qb_customer_full_name: result.fullName ?? null,
        last_synced_at: new Date().toISOString(),
        last_sync_source: 'qbwc_pull',
      })
    } else {
      await markQueueError(db, session.pending_order_id, `Customer creation failed: ${result.status.message || 'unknown error'}`, responseXml)
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
    } else if (isNotFoundStatus(result.status)) {
      await setPending(db, ticket, 'item_add', session.pending_order_id, session.pending_ref)
      shouldClearPending = false
    } else {
      await markQueueError(db, session.pending_order_id, `Item lookup failed for SKU ${session.pending_ref}: ${result.status.message || 'no match in QuickBooks'}`, responseXml)
    }
  } else if (session?.pending_request_kind === 'item_add' && session.pending_order_id && session.pending_ref) {
    const result = parseItemAddRs(responseXml)
    if (result.status.ok && result.listId) {
      await db.from('qb_item_links').upsert({
        sku: session.pending_ref,
        qb_item_list_id: result.listId,
        qb_item_full_name: result.fullName ?? null,
        last_synced_at: new Date().toISOString(),
        last_sync_source: 'qbwc_pull',
      })
    } else {
      await markQueueError(db, session.pending_order_id, `Item creation failed for SKU ${session.pending_ref}: ${result.status.message || 'unknown error'}`, responseXml)
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
  } else if (session?.pending_request_kind === 'customer_full_query') {
    const result = parseCustomerFullQueryRs(responseXml)
    const pull = await getCustomerPullState(db)
    const pulledSoFar = (pull?.pulled_count ?? 0) + result.customers.length
    if (!result.status.ok) {
      await updateCustomerPullState(db, { status: 'error', error_message: result.status.message || 'Customer pull failed' })
    } else {
      if (result.customers.length > 0) {
        await db.from('qb_customer_directory').upsert(
          result.customers.map((c) => ({
            qb_customer_list_id: c.listId,
            full_name: c.fullName,
            company_name: c.companyName ?? null,
            email: c.email ?? null,
            phone: c.phone ?? null,
            pulled_at: new Date().toISOString(),
          })),
        )
      }
      if (result.iteratorId && (result.remainingCount ?? 0) > 0) {
        // More pages remain — stay in customer_full_query so the next
        // sendRequestXML (still in this same session) continues the iterator.
        await updateCustomerPullState(db, { status: 'in_progress', iterator_id: result.iteratorId, pulled_count: pulledSoFar })
        shouldClearPending = false
      } else {
        await updateCustomerPullState(db, {
          status: 'done',
          iterator_id: null,
          pulled_count: pulledSoFar,
          completed_at: new Date().toISOString(),
        })
      }
    }
  }

  if (session && shouldClearPending) await clearPending(db, ticket)

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
