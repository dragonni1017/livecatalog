// What we already know about a net-terms applicant (/admin/credit-applications).
// Pure: the page loads the rows, this matches them to the application.
//
// Payment history is NOT in this system (invoices and A/R live in
// QuickBooks), so this never claims anything about paying on time. It shows:
// their quotes on the site, whether they're a catalog / Erply / QuickBooks
// customer, and earlier applications.

export interface HistoryApplication {
  id: string
  email: string
  company_name: string
  created_at: string
}
export interface HistoryOrder {
  customer_email: string | null
  status: string
  subtotal_cents: number
  created_at: string
  dismissed_at: string | null
}
export interface HistoryCustomer { email: string; price_tier_code: string | null; created_at: string }
export interface HistoryQbCustomer { full_name: string; company_name: string | null; email: string | null }
export interface HistoryErplyLink { email: string; erply_customer_id: string | null; erply_tier: string | null }
export interface HistoryOtherApplication { id: string; email: string; company_name: string; status: string; created_at: string }

export interface CreditHistory {
  quotes: number
  converted: number
  convertedCents: number
  open: number
  firstQuote: string | null
  lastQuote: string | null
  catalogCustomer: { since: string; tier: string | null } | null
  /** How the QuickBooks customer list matched, or null. */
  quickBooks: { by: 'email' | 'company name'; name: string } | null
  erply: { tier: string | null } | null
  earlierApplications: { status: string; created_at: string }[]
}

const em = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const SUFFIX = /\b(incorporated|inc|llc|l\.l\.c|ltd|co|corp|corporation|company)\b\.?/g
/** "Acme Floral, Inc." and "ACME FLORAL" compare equal; too-short names never match. */
export function companyKey(s: string | null | undefined): string {
  const k = (s ?? '').toLowerCase().replace(SUFFIX, ' ').replace(/[^a-z0-9]+/g, '')
  return k.length >= 4 ? k : ''
}

export function creditHistory(
  app: HistoryApplication,
  data: {
    orders: HistoryOrder[]
    customers: HistoryCustomer[]
    qbCustomers: HistoryQbCustomer[]
    erplyLinks: HistoryErplyLink[]
    applications: HistoryOtherApplication[]
  },
): CreditHistory {
  const email = em(app.email)
  const company = companyKey(app.company_name)
  const mine = data.orders.filter((o) => email && em(o.customer_email) === email && !o.dismissed_at)
  const dates = mine.map((o) => o.created_at).sort()
  const converted = mine.filter((o) => o.status === 'converted')
  const cust = data.customers.find((c) => email && em(c.email) === email)
  const qbByEmail = data.qbCustomers.find((q) => email && em(q.email) === email)
  const qbByCompany = !qbByEmail && company ? data.qbCustomers.find((q) => companyKey(q.company_name) === company || companyKey(q.full_name) === company) : undefined
  const link = data.erplyLinks.find((l) => email && em(l.email) === email && l.erply_customer_id)
  return {
    quotes: mine.length,
    converted: converted.length,
    convertedCents: converted.reduce((n, o) => n + (o.subtotal_cents ?? 0), 0),
    open: mine.filter((o) => o.status === 'new' || o.status === 'contacted').length,
    firstQuote: dates[0] ?? null,
    lastQuote: dates[dates.length - 1] ?? null,
    catalogCustomer: cust ? { since: cust.created_at, tier: cust.price_tier_code } : null,
    quickBooks: qbByEmail
      ? { by: 'email', name: qbByEmail.company_name || qbByEmail.full_name }
      : qbByCompany
        ? { by: 'company name', name: qbByCompany.company_name || qbByCompany.full_name }
        : null,
    erply: link ? { tier: link.erply_tier } : null,
    earlierApplications: data.applications
      .filter((a) => a.id !== app.id && a.created_at < app.created_at && ((email && em(a.email) === email) || (company && companyKey(a.company_name) === company)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => ({ status: a.status, created_at: a.created_at })),
  }
}

/** Short line for the table row: "3 quotes, 1 converted ($1,240) · in QuickBooks". */
export function historyLine(h: CreditHistory): string {
  const parts: string[] = []
  parts.push(h.quotes === 0 ? 'No quotes on the site' : `${h.quotes} quote${h.quotes === 1 ? '' : 's'}, ${h.converted} converted${h.converted ? ` ($${(h.convertedCents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })})` : ''}`)
  if (h.quickBooks) parts.push('in QuickBooks')
  if (h.erply) parts.push('in Erply')
  if (h.earlierApplications.length) parts.push(`applied before (${h.earlierApplications.length})`)
  if (!h.quickBooks && !h.erply && !h.catalogCustomer && h.quotes === 0) parts.push('new to us')
  return parts.join(' · ')
}
