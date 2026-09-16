/**
 * Commercial Invoice parsing + joining invoice rows to packing-list lines.
 *
 * Why this file exists: a supplier packing list has no English product name.
 * 品名 is usually blank (3 of 12 rows on container EGSU9522424) and when
 * present it's Chinese. The English lives on the Commercial Invoice, written
 * for customs:
 *
 *     "Party Crown Tiara Style 15cm - 100% Zinc Alloy"
 *     "Squeeze Toy Giant Drumstick Style - 100%TPR"
 *
 * Two structural facts make the join non-trivial, both confirmed against
 * EGSU9522424 on 2026-09-16:
 *
 *  - The invoice's `Item#` column is EMPTY on every row. The leading number
 *    is a line counter, not a SKU. There is no SKU on the invoice at all.
 *  - **Invoice rows group colourways.** Row 1 is 50 cartons / 600 pieces,
 *    which is exactly the four F288023-WN/BLK/LPK/VLT packing-list rows
 *    (15+15+15+5 cartons, 180+180+180+60 pieces).
 *
 * So the join is by arithmetic: cartons AND pieces must both reconcile, and
 * the match must be unique. That is the same discipline the QuickBooks
 * customer matcher uses — a non-unique match is held for a human rather than
 * guessed at (see docs/memory/project-qb-customer-matching.md).
 */

import type { SheetRow } from '@/lib/packing-list'
import { normalizeDescriptor } from '@/lib/product-naming'

export interface InvoiceLine {
  lineNo: number
  description: string
  cartons: number
  pieces: number
  unitPriceUsd: number | null
}

export class CommercialInvoiceError extends Error {}

const HEADER_NEEDLE = 'descriptions of goods'

function findCol(headerRow: SheetRow, needle: string): number {
  const n = needle.toLowerCase()
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i]
    if (typeof cell === 'string' && cell.toLowerCase().includes(n)) return i
  }
  return -1
}

/**
 * Reads the line-item table out of a Commercial Invoice sheet. The header sits
 * well down the page (row 15 on the sample, under the supplier letterhead),
 * and the table ends at a "Total" row whose figures are a useful cross-check —
 * EGSU9522424 totals 738 cartons, which matches the "738ctn" in its filename.
 */
export function parseCommercialInvoiceSheet(rows: SheetRow[]): {
  lines: InvoiceLine[]
  totalCartons: number | null
  totalPieces: number | null
} {
  const headerRowIndex = rows.findIndex(
    (r) => Array.isArray(r) && r.some((c) => typeof c === 'string' && c.toLowerCase().includes(HEADER_NEEDLE)),
  )
  if (headerRowIndex < 0) {
    throw new CommercialInvoiceError(
      'No "Descriptions of Goods" column found — this doesn\'t look like a Commercial Invoice. The Packing List workbook shares the same letterhead but has no line-item table this parser understands.',
    )
  }

  const header = rows[headerRowIndex]
  const iDesc = findCol(header, HEADER_NEEDLE)
  const iCtn = findCol(header, 'package')
  const iPcs = findCol(header, 'quantity')
  const iUnit = findCol(header, 'unit')

  if (iCtn < 0 || iPcs < 0) {
    throw new CommercialInvoiceError(
      `Found the description column but no PACKAGE (ctns) / QUANTITY (pcs) columns. Header read as: ${JSON.stringify(header)}`,
    )
  }

  const lines: InvoiceLine[] = []
  let totalCartons: number | null = null
  let totalPieces: number | null = null

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? []
    const first = row[0]

    // The totals row closes the table. Trailing rows carrying only a line
    // number are padding on the printed form and are skipped, not treated as
    // the end — the sample has five of them before the total.
    if (typeof first === 'string' && first.trim().toLowerCase().startsWith('total')) {
      totalCartons = typeof row[iCtn] === 'number' ? (row[iCtn] as number) : null
      totalPieces = typeof row[iPcs] === 'number' ? (row[iPcs] as number) : null
      break
    }

    const description = typeof row[iDesc] === 'string' ? row[iDesc].trim() : ''
    const cartons = row[iCtn]
    const pieces = row[iPcs]
    if (!description || typeof cartons !== 'number' || typeof pieces !== 'number') continue

    lines.push({
      lineNo: typeof first === 'number' ? first : lines.length + 1,
      description: description.replace(/\s+/g, ' '),
      cartons,
      pieces,
      unitPriceUsd: typeof row[iUnit] === 'number' ? (row[iUnit] as number) : null,
    })
  }

  return { lines, totalCartons, totalPieces }
}

/** "F288023-WN" -> "F288023". Suffixes carry colour, size or variant. */
export function baseSku(sku: string): string {
  const dash = sku.indexOf('-')
  return dash > 0 ? sku.slice(0, dash) : sku
}

/**
 * Colour/variant codes seen on real SKU suffixes. Unknown codes pass through
 * verbatim rather than being guessed at — a wrong colour in a product name is
 * worse than an unexpanded one, and the admin edits the name anyway.
 */
const SUFFIX_WORDS: Record<string, string> = {
  WN: 'Wine',
  BLK: 'Black',
  LPK: 'Light Pink',
  PINK: 'Pink',
  VLT: 'Violet',
  CREAM: 'Cream',
  LB: 'Light Blue',
  G: 'Gold',
  RED: 'Red',
  WHT: 'White',
  BLU: 'Blue',
  GRN: 'Green',
}

export function suffixLabel(sku: string): string | null {
  const dash = sku.indexOf('-')
  if (dash < 0) return null
  const raw = sku.slice(dash + 1).trim()
  if (!raw) return null
  // A size-like suffix (80CM, 45CM, 1.5M) reads as a size, not a colour.
  if (/^\d+(\.\d+)?\s*(cm|mm|m|in|")$/i.test(raw)) return raw.toUpperCase().replace(/CM$/, 'cm')
  return SUFFIX_WORDS[raw.toUpperCase()] ?? raw
}

export interface JoinCandidate {
  sku: string
  qtyShipped: number
  cartons: number | null
}

export interface JoinResult {
  sku: string
  invoiceLineNo: number | null
  description: string | null
  unitPriceUsd: number | null
  /** How the line was matched, for display — never hidden from the admin. */
  basis: 'cartons+pieces' | 'pieces' | 'family-share' | 'none'
}

/**
 * Joins packing-list lines to invoice rows.
 *
 * Tiers, strictest first, mirroring the QB matcher's "unique or nothing" rule:
 *  1. A single SKU whose cartons AND pieces equal an invoice row's.
 *  2. A base-SKU family (F288023-*) whose cartons AND pieces SUM to a row's —
 *     every member gets that description. This is the colourway case.
 *  3. A unique match on pieces alone, when the sheet has no carton column.
 * Anything else is left unmatched for the admin to fill in by hand.
 */
export function joinInvoiceToLines(invoice: InvoiceLine[], candidates: JoinCandidate[]): JoinResult[] {
  const results = new Map<string, JoinResult>()
  for (const c of candidates) {
    results.set(c.sku, { sku: c.sku, invoiceLineNo: null, description: null, unitPriceUsd: null, basis: 'none' })
  }

  const claimed = new Set<number>()

  const assign = (skus: string[], line: InvoiceLine, basis: JoinResult['basis']) => {
    claimed.add(line.lineNo)
    for (const sku of skus) {
      results.set(sku, {
        sku,
        invoiceLineNo: line.lineNo,
        description: line.description,
        unitPriceUsd: line.unitPriceUsd,
        basis,
      })
    }
  }

  // Tier 1 — exact single-SKU match on both figures.
  for (const line of invoice) {
    if (claimed.has(line.lineNo)) continue
    const exact = candidates.filter((c) => c.cartons === line.cartons && c.qtyShipped === line.pieces)
    if (exact.length === 1 && results.get(exact[0].sku)!.basis === 'none') {
      assign([exact[0].sku], line, 'cartons+pieces')
    }
  }

  // Tier 2 — a base-SKU family summing to the row (grouped colourways).
  const families = new Map<string, JoinCandidate[]>()
  for (const c of candidates) {
    const key = baseSku(c.sku)
    if (!families.has(key)) families.set(key, [])
    families.get(key)!.push(c)
  }

  for (const line of invoice) {
    if (claimed.has(line.lineNo)) continue
    const hits: JoinCandidate[][] = []
    for (const members of families.values()) {
      const unassigned = members.filter((m) => results.get(m.sku)!.basis === 'none')
      // Two or more: this tier exists for grouped colourways. A lone SKU is
      // tier 1's or tier 3's job, and letting it through here would report a
      // "family-share" basis for a match that shared nothing.
      if (unassigned.length < 2) continue
      const pieces = unassigned.reduce((s, m) => s + m.qtyShipped, 0)
      const cartons = unassigned.every((m) => m.cartons != null)
        ? unassigned.reduce((s, m) => s + (m.cartons ?? 0), 0)
        : null
      if (pieces === line.pieces && (cartons === null || cartons === line.cartons)) hits.push(unassigned)
    }
    if (hits.length === 1) assign(hits[0].map((m) => m.sku), line, 'family-share')
  }

  // Tier 3 — unique match on pieces alone.
  for (const line of invoice) {
    if (claimed.has(line.lineNo)) continue
    const byPieces = candidates.filter(
      (c) => c.qtyShipped === line.pieces && results.get(c.sku)!.basis === 'none',
    )
    if (byPieces.length === 1) assign([byPieces[0].sku], line, 'pieces')
  }

  return [...results.values()]
}

/**
 * Turns an invoice description into a house-standard descriptor, appending the
 * SKU suffix's colour/size where there is one. The pack spec is NOT added
 * here: cs.N comes from the shipment (pieces / cartons) and the pack split
 * needs a human, so lib/product-naming.ts assembles the final name.
 */
export function proposeDescriptor(description: string | null, sku: string): string {
  const base = normalizeDescriptor(description ?? '')
  const suffix = suffixLabel(sku)
  if (!base) return suffix ?? ''
  if (!suffix) return base
  // Colour leads, matching the catalog's own style ("Pink Heart Plastic
  // Floral Paper", "Black Romantic Ribbon").
  return /^\d/.test(suffix) ? `${suffix} ${base}` : `${suffix} ${base}`
}
