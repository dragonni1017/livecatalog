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
  // Carton count for the line. Needed to derive pieces-per-case, and to join
  // a line against a Commercial Invoice row (see lib/commercial-invoice.ts) —
  // invoice rows group colourways, and cartons + pieces are what reconcile
  // the two. Optional: a sheet without it still receives fine.
  cartons: ['箱数'],
}

// Which COLUMN fields are a carton dimension axis, and the label used when
// one can't be resolved. 毛重 is deliberately absent: it names exactly one
// column on every known sheet.
const DIMENSION_AXES: Record<string, string> = {
  lengthDim: 'length (长)',
  widthDim: 'width (宽)',
  heightDim: 'height (高)',
}

// The piece-count column is the one header that genuinely changes between
// suppliers and years, so it's matched against a list of ALTERNATIVES rather
// than one pattern. Confirmed live:
//   'QTY'   — container EMCU8402359 (2023-11), English header
//   '总PCS' — container EGSU9522424 (2026-08), on both the Arrival List and
//             the Original List; this format has no English QTY column at all
// Deliberately NOT matched: 总量KG (total kilograms) and 总体积 (total volume)
// are also line totals but in other units, and 箱数/CTN is cartons, not
// pieces. Add a new alternative here only after reading the real header off
// the file — a wrong guess here means registering the wrong stock quantity.
const QTY_COLUMN_ALTERNATIVES: string[][] = [['qty'], ['总pcs']]

// SKU and piece count are the only required columns — checked individually
// below so each gets its own actionable message. Dimensions and weight are
// optional: a sheet can legitimately be a quantities-only list, and receiving
// only needs SKU + pieces.

export type SheetRow = Array<string | number | null | undefined>

export interface PackingListLine {
  sku: string
  barcodeFromFile: string | null
  qtyShipped: number
  /** Cartons for this line (箱数 CTN). Null when the sheet omits the column. */
  cartons: number | null
  /**
   * Pieces in one carton, derived as qtyShipped / cartons rather than read
   * from the sheet's own pk/cs column — the arithmetic is unambiguous where
   * the column's meaning isn't. Verified on container EGSU9522424: S162782
   * ships 1,920 pieces in 80 cartons and its pk/cs column reads 24, which is
   * exactly 1920/80. Null when cartons are missing or it doesn't divide
   * evenly (a mixed-carton line, which shouldn't be guessed at).
   *
   * This is the cs.N of the house naming standard — see lib/product-naming.ts.
   */
  piecesPerCase: number | null
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

// Case-insensitive so a sheet headed "Qty" or "总pcs" matches the same rules
// as one headed "QTY" — lowercasing leaves the Chinese headers untouched.
function findCol(headerRow: SheetRow, substrings: string[]): number {
  const needles = substrings.map((s) => s.toLowerCase())
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i]
    if (typeof cell !== 'string') continue
    const haystack = cell.toLowerCase()
    if (needles.every((s) => haystack.includes(s))) return i
  }
  return -1
}

// First alternative that matches wins.
function findColAny(headerRow: SheetRow, alternatives: string[][]): number {
  for (const alt of alternatives) {
    const idx = findCol(headerRow, alt)
    if (idx >= 0) return idx
  }
  return -1
}

function findAllCols(headerRow: SheetRow, substrings: string[]): number[] {
  const needles = substrings.map((s) => s.toLowerCase())
  const hits: number[] = []
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i]
    if (typeof cell !== 'string') continue
    const haystack = cell.toLowerCase()
    if (needles.every((s) => haystack.includes(s))) hits.push(i)
  }
  return hits
}

// 外箱 = "outer carton". The marker that separates the carton's dimensions
// from the PRODUCT's, and the reason a dimension column can't just be the
// first header containing 长.
const CARTON_MARKER = '外箱'

/**
 * Picks the carton dimension column for one axis.
 *
 * The 2026 supplier format heads its product-spec column
 * `产品规格尺寸长*宽*高（CM）` — one cell containing 长 AND 宽 AND 高 AND "CM",
 * sitting to the LEFT of the real `长cm(外箱)` / `宽cm(外箱)` / `高cm(外箱)`
 * columns. Taking the first match therefore pointed all three axes at that
 * single spec column, which silently produced either null cartons (the cell
 * is text like "57*57CM") or a bogus L=W=H cube (the cell is a bare number).
 * Both were found on the 2026-09-17 containers; the 2023 format was unaffected
 * because its spec column isn't labelled with 长 at all.
 *
 * So: prefer the column that says 外箱. Fall back to a lone candidate, since a
 * sheet with exactly one 长 column has nothing to confuse it with. Refuse to
 * choose between several unmarked candidates rather than guess — a wrong
 * carton dimension feeds Erply bin capacity as fact.
 */
function findDimensionCol(headerRow: SheetRow, axis: string, substrings: string[]): number {
  const candidates = findAllCols(headerRow, substrings)
  if (candidates.length <= 1) return candidates[0] ?? -1

  const carton = candidates.filter((i) => String(headerRow[i]).includes(CARTON_MARKER))
  if (carton.length === 1) return carton[0]

  throw new PackingListError(
    `Ambiguous ${axis} column: ${candidates.length} headers match ${substrings.join('+')} and ` +
      `${carton.length === 0 ? 'none' : carton.length} say ${CARTON_MARKER} (outer carton) — ` +
      `${candidates.map((i) => `col ${i} ${JSON.stringify(headerRow[i])}`).join(', ')}. ` +
      `Refusing to guess which is the carton rather than the product.`,
  )
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
 *
 * "Digits only" means every non-digit is dropped, not just the surrounding
 * whitespace: supplier sheets type UPCs with spaces inside them (EGSU1396926
 * ships T641449 as "6  8140239892 8"), and reading that as different from the
 * stored 681402398928 would strand a good line as a barcode_mismatch and
 * exclude it from apply.
 */
export function normalizeBarcode(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '').replace(/^0+/, '')
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
    // The three axes can collide with a combined product-spec header; the
    // other columns are matched on text that only ever names one column.
    colIndex[field] = DIMENSION_AXES[field]
      ? findDimensionCol(headerRow, DIMENSION_AXES[field], substrings)
      : findCol(headerRow, substrings)
  }
  colIndex.qty = findColAny(headerRow, QTY_COLUMN_ALTERNATIVES)

  if (colIndex.sku < 0) {
    throw new PackingListError(
      `Could not find a SKU column (looking for ${COLUMN.sku.join(' + ')}). Header row read as: ${JSON.stringify(headerRow)}`,
    )
  }
  if (colIndex.qty < 0) {
    throw new PackingListError(
      `Could not find a piece-count column — tried ${QTY_COLUMN_ALTERNATIVES.map((a) => a.join('+')).join(', ')}. ` +
        `Header row read as: ${JSON.stringify(headerRow)}. If this supplier names it something else, add it to ` +
        `QTY_COLUMN_ALTERNATIVES in lib/packing-list.ts after checking the real header — don't guess, a wrong column registers the wrong stock.`,
    )
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

    const rawCartons = colIndex.cartons >= 0 ? row[colIndex.cartons] : null
    const cartons = typeof rawCartons === 'number' && Number.isInteger(rawCartons) && rawCartons > 0 ? rawCartons : null
    // Only when it divides evenly: a non-integer means mixed cartons, and a
    // guessed case quantity would end up in a product name as fact.
    const piecesPerCase = cartons && qty % cartons === 0 ? qty / cartons : null

    lines.push({
      sku,
      barcodeFromFile: rawUpc == null || rawUpc === '' ? null : String(rawUpc).trim(),
      qtyShipped: qty,
      cartons,
      piecesPerCase,
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
    if (line.cartons != null) existing.cartons = (existing.cartons ?? 0) + line.cartons
    // Recompute rather than summing: pieces-per-case is a rate, not a total.
    existing.piecesPerCase =
      existing.cartons && existing.qtyShipped % existing.cartons === 0
        ? existing.qtyShipped / existing.cartons
        : null
    // Keep the first line's carton figures and barcode: cartons in one line
    // group are the same physical product, and a later row's blank cells
    // shouldn't erase what the first row supplied.
    existing.barcodeFromFile = existing.barcodeFromFile ?? line.barcodeFromFile
  }
  return [...bySku.values()]
}
