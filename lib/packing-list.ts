/**
 * Supplier "Original List" packing-list parsing — the canonical copy.
 *
 * Ported from scripts/import-packing-list.mjs, which is KEPT as a mirror
 * because a .mjs cannot import TypeScript (same constraint as
 * implausibleCaseMeasurement's four copies — see lib/measurements.ts). Change
 * the rules here and change them there.
 *
 * Takes raw sheet rows (array-of-arrays, as produced by
 * XLSX.utils.sheet_to_json(sheet, { header: 1 })) rather than a file, so the
 * browser can read the workbook — the same client-side parse
 * components/admin/ExcelDropzone.tsx already does for product imports — while
 * every rule that decides a quantity stays here, server-side.
 *
 * Confirmed against a real file 2026-09-14 (container EMCU8402359, "Round"):
 * the sheet has a 货号 column that IS the Erply/Supabase SKU verbatim (format
 * F######), a UPC column matching products.barcode, and a QTY column of total
 * pieces per line.
 *
 * Column layout varies by supplier, so columns are found BY HEADER TEXT, and
 * units are read FROM the header text ("长cm(外箱)" → cm, "毛重KG（每包装箱）" →
 * kg) — never assumed. A header with no recognizable unit is a hard error,
 * not a guess.
 */

// Header text -> field, matched by "contains all of these substrings" rather
// than exact equality, so punctuation/spacing drift across shipments
// (fullwidth vs halfwidth parens, extra spaces) doesn't break it.
const COLUMN: Record<string, string[]> = {
  sku: ['货号'],
  upc: ['UPC'],
  // This file's quantity column is literally headed "QTY" in English --
  // deliberately not matching 总量KG / 总体积, which are totals per line in
  // other units.
  qty: ['QTY'],
  // Deliberately unit-agnostic, unlike the .mjs mirror which matches
  // ['长', 'cm']: the column is located by dimension name alone, and the unit
  // is then REQUIRED in whatever header was found (see dimensionFactor).
  // Matching on 'cm' instead means an inch- or metre-labelled sheet fails to
  // match the column at all and the carton figures go silently null, which is
  // the failure mode this project keeps getting bitten by. Now such a sheet
  // either parses correctly or errors loudly.
  lengthDim: ['长'],
  widthDim: ['宽'],
  heightDim: ['高'],
  // 毛重 (gross weight) distinguishes this from 总量KG (total kg across all
  // cartons in the line).
  weight: ['毛重'],
}

// Dimensions and weight are optional: a sheet can legitimately be a
// quantities-only list, and Phase 1 only needs SKU + QTY to receive stock.
const REQUIRED_FIELDS = ['sku', 'qty'] as const

export type SheetRow = Array<string | number | null | undefined>

export interface PackingListLine {
  sku: string
  barcodeFromFile: string | null
  qtyShipped: number
  caseLengthIn: number | null
  caseWidthIn: number | null
  caseHeightIn: number | null
  caseWeightLb: number | null
}

export interface PackingListProblem {
  where: string
  problem: string
}

export interface PackingListParse {
  lines: PackingListLine[]
  problems: PackingListProblem[]
  // Human-readable note for the UI, e.g. "dims in cm, weight in kg".
  unitNote: string | null
  headerRowIndex: number
}

export class PackingListError extends Error {}

function findHeaderRow(rows: SheetRow[]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] ?? []
    if (row.some((cell) => typeof cell === 'string' && cell.includes('货号'))) return i
  }
  return -1
}

function findCol(headerRow: SheetRow, substrings: string[]): number {
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i]
    if (typeof cell !== 'string') continue
    if (substrings.every((s) => cell.includes(s))) return i
  }
  return -1
}

interface UnitFactor {
  factor?: number
  unit?: string
  error?: string
}

function dimensionFactor(header: string): UnitFactor {
  const h = header.toLowerCase()
  if (h.includes('cm')) return { factor: 1 / 2.54, unit: 'cm' }
  if (h.includes('(m)') || /\bm\)/.test(h)) return { factor: 39.3700787, unit: 'm' }
  if (h.includes('in')) return { factor: 1, unit: 'in' }
  return { error: `can't tell what unit "${header}" is in` }
}

function weightFactor(header: string): UnitFactor {
  const h = header.toLowerCase()
  if (h.includes('kg')) return { factor: 2.20462262, unit: 'kg' }
  if (h.includes('lb')) return { factor: 1, unit: 'lb' }
  return { error: `can't tell what unit "${header}" is in` }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Barcodes have a documented leading-zero gap in this project (see
 * docs/memory/reference-barcode-backfill-handoff.md) — compare digits only,
 * with leading zeros stripped, rather than exact string equality.
 */
export function normalizeBarcode(v: unknown): string {
  return String(v ?? '').trim().replace(/^0+/, '')
}

/**
 * Parses one packing-list sheet. Throws PackingListError for a file this
 * parser doesn't understand (no 货号 column, a missing required column, an
 * unlabelled unit) — a hard error rather than a partial read, since guessing
 * here would mean guessing a received quantity.
 *
 * Per-row trouble (blank SKU, non-numeric qty) is collected into `problems`
 * instead, so one bad line doesn't reject the whole container.
 */
export function parsePackingListSheet(rows: SheetRow[]): PackingListParse {
  const headerRowIndex = findHeaderRow(rows)
  if (headerRowIndex < 0) {
    throw new PackingListError(
      "No 货号 (SKU) column found in the first 10 rows — this doesn't look like a supplier packing list. Only files named \"*Original List*.xls/.xlsx\" are known to work; the \"Arrival List\" PDFs have no SKU column at all.",
    )
  }

  const headerRow = rows[headerRowIndex] ?? []
  const colIndex: Record<string, number> = {}
  for (const [field, substrings] of Object.entries(COLUMN)) {
    colIndex[field] = findCol(headerRow, substrings)
  }

  for (const field of REQUIRED_FIELDS) {
    if (colIndex[field] < 0) {
      throw new PackingListError(
        `Could not find a ${field.toUpperCase()} column (looking for ${COLUMN[field].join(' + ')}). Header row read as: ${JSON.stringify(headerRow)}`,
      )
    }
  }

  // Dimensions are all-or-nothing: a sheet either has the full set of
  // labelled dimension columns or is treated as quantities-only. A partial
  // set would mean writing a carton with no height.
  const dimCols = ['lengthDim', 'widthDim', 'heightDim', 'weight']
  const hasDims = dimCols.every((f) => colIndex[f] >= 0)

  let lenU: UnitFactor = {}
  let widU: UnitFactor = {}
  let hgtU: UnitFactor = {}
  let wgtU: UnitFactor = {}
  let unitNote: string | null = null

  if (hasDims) {
    lenU = dimensionFactor(String(headerRow[colIndex.lengthDim]))
    widU = dimensionFactor(String(headerRow[colIndex.widthDim]))
    hgtU = dimensionFactor(String(headerRow[colIndex.heightDim]))
    wgtU = weightFactor(String(headerRow[colIndex.weight]))
    const unitError = [lenU, widU, hgtU, wgtU].find((u) => u.error)?.error
    if (unitError) throw new PackingListError(unitError)
    unitNote = `dimensions in ${lenU.unit}/${widU.unit}/${hgtU.unit}, weight in ${wgtU.unit}`
  }

  const dataRows = rows.slice(headerRowIndex + 1).filter((r) => r && r[colIndex.sku])
  const lines: PackingListLine[] = []
  const problems: PackingListProblem[] = []

  for (const row of dataRows) {
    const sku = String(row[colIndex.sku]).trim()
    if (!sku) continue
    const where = `SKU ${sku}`

    const rawQty = row[colIndex.qty]
    const qty = typeof rawQty === 'number' ? rawQty : Number(String(rawQty ?? '').trim())
    if (!Number.isFinite(qty) || qty <= 0) {
      problems.push({ where, problem: `QTY is not a positive number (${JSON.stringify(rawQty)})` })
      continue
    }
    if (!Number.isInteger(qty)) {
      problems.push({ where, problem: `QTY is fractional (${qty}) — pieces should be whole units` })
      continue
    }

    const rawUpc = colIndex.upc >= 0 ? row[colIndex.upc] : null
    let dims: Pick<PackingListLine, 'caseLengthIn' | 'caseWidthIn' | 'caseHeightIn' | 'caseWeightLb'> = {
      caseLengthIn: null,
      caseWidthIn: null,
      caseHeightIn: null,
      caseWeightLb: null,
    }

    if (hasDims) {
      const raw = [row[colIndex.lengthDim], row[colIndex.widthDim], row[colIndex.heightDim], row[colIndex.weight]]
      // Missing or non-numeric dimensions don't reject the line in Phase 1 —
      // the quantity is what's being received. They're just left null.
      if (raw.every((v) => typeof v === 'number')) {
        const [l, w, h, g] = raw as number[]
        dims = {
          caseLengthIn: round2(l * lenU.factor!),
          caseWidthIn: round2(w * widU.factor!),
          caseHeightIn: round2(h * hgtU.factor!),
          caseWeightLb: round2(g * wgtU.factor!),
        }
      }
    }

    lines.push({
      sku,
      barcodeFromFile: rawUpc == null || rawUpc === '' ? null : String(rawUpc).trim(),
      qtyShipped: qty,
      ...dims,
    })
  }

  if (lines.length === 0) {
    throw new PackingListError(
      `Found the header row but no usable line items below it${problems.length ? ` (${problems.length} row(s) had problems — see below)` : ''}.`,
    )
  }

  return { lines, problems, unitNote, headerRowIndex }
}

/**
 * Collapses repeated SKUs into one line, summing quantities — a container
 * often lists the same SKU across several cartons. Mirrors the same
 * upper-cased grouping key add-stock-from-packing-list.mjs uses, so a sheet
 * mixing "f123456" and "F123456" registers once, not twice.
 */
export function groupLinesBySku(lines: PackingListLine[]): PackingListLine[] {
  const bySku = new Map<string, PackingListLine>()
  for (const line of lines) {
    const key = line.sku.toUpperCase()
    const existing = bySku.get(key)
    if (!existing) {
      bySku.set(key, { ...line })
      continue
    }
    existing.qtyShipped += line.qtyShipped
    // Keep the first line's carton figures and barcode: cartons in one line
    // group are the same physical product, and a later row's blank cells
    // shouldn't erase what the first row supplied.
    existing.barcodeFromFile = existing.barcodeFromFile ?? line.barcodeFromFile
  }
  return [...bySku.values()]
}
