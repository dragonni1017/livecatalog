import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { createRequire } from 'module'
import {
  groupLinesBySku,
  normalizeBarcode,
  parsePackingListSheet,
  PackingListError,
  type SheetRow,
} from '@/lib/packing-list'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XLSX: any = require('xlsx')

// Synthetic sheets mirror the real supplier layout: a title row above the
// header, Chinese headers naming their own units, SKU in 货号, quantity in an
// English "QTY" column.
const HEADER = ['货号', 'UPC', 'QTY', '长cm(外箱)', '宽cm(外箱)', '高cm(外箱)', '毛重KG（每包装箱）']

function sheet(rows: SheetRow[]): SheetRow[] {
  return [['SOME SUPPLIER PACKING LIST', null, null], HEADER, ...rows]
}

describe('parsePackingListSheet', () => {
  it('reads SKU, quantity and converts cm/kg cartons to inches/pounds', () => {
    const parsed = parsePackingListSheet(sheet([['F123456', '0712345678901', 240, 50.8, 25.4, 25.4, 10]]))

    expect(parsed.problems).toEqual([])
    expect(parsed.unitNote).toBe('dimensions in cm/cm/cm, weight in kg')
    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0]).toMatchObject({
      sku: 'F123456',
      barcodeFromFile: '0712345678901',
      qtyShipped: 240,
      caseLengthIn: 20,
      caseWidthIn: 10,
      caseHeightIn: 10,
      caseWeightLb: 22.05,
    })
  })

  it('refuses a sheet with no SKU column rather than guessing', () => {
    expect(() => parsePackingListSheet([['Item', 'Qty'], ['widget', 5]])).toThrow(PackingListError)
  })

  it('refuses a dimension header that does not name its unit', () => {
    const noUnit = [HEADER.slice()]
    noUnit[0][3] = '长（外箱）' // no cm/m/in anywhere
    expect(() =>
      parsePackingListSheet([...noUnit, ['F1', '1', 1, 1, 1, 1, 1]] as SheetRow[]),
    ).toThrow(/can't tell what unit/)
  })

  it('collects per-row problems instead of rejecting the whole container', () => {
    const parsed = parsePackingListSheet(
      sheet([
        ['F111111', '1', 100, 50, 25, 25, 10],
        ['F222222', '2', 'twelve', 50, 25, 25, 10],
        ['F333333', '3', 0, 50, 25, 25, 10],
        ['F444444', '4', 12.5, 50, 25, 25, 10],
      ]),
    )

    expect(parsed.lines.map((l) => l.sku)).toEqual(['F111111'])
    expect(parsed.problems).toHaveLength(3)
    expect(parsed.problems[1].problem).toMatch(/not a positive number/)
    expect(parsed.problems[2].problem).toMatch(/fractional/)
  })

  // The 2026 supplier format puts a combined product-spec header
  // (产品规格尺寸长*宽*高（CM）) to the LEFT of the real carton columns. It
  // contains 长, 宽, 高 and "CM", so matching the first hit pointed all three
  // axes at it — silently nulling cartons when the cell is text, and
  // inventing an L=W=H cube when it's a number. 外箱 ("outer carton") is what
  // tells the two apart.
  it('reads carton dimensions past a combined product-spec column', () => {
    const header = ['货号', 'UPC', '总PCS', '产品规格尺寸长*宽*高（CM）', ...HEADER.slice(3)]
    const parsed = parsePackingListSheet([
      header,
      ['F288116', '737879112175', 1800, '57*57CM', 62, 32, 15, 17],
    ])

    expect(parsed.problems).toEqual([])
    expect(parsed.lines[0]).toMatchObject({
      sku: 'F288116',
      qtyShipped: 1800,
      caseLengthIn: 24.41,
      caseWidthIn: 12.6,
      caseHeightIn: 5.91,
      caseWeightLb: 37.48,
    })
  })

  it('does not mistake a numeric product-spec cell for a cube-shaped carton', () => {
    const header = ['货号', 'UPC', '总PCS', '产品规格尺寸长*宽*高（CM）', ...HEADER.slice(3)]
    const parsed = parsePackingListSheet([header, ['S121037', '1', 36000, 8.5, 62, 32, 15, 19]])

    const line = parsed.lines[0]
    expect(line.caseLengthIn).not.toBe(line.caseWidthIn)
    expect(line.caseLengthIn).toBe(24.41)
  })

  it('refuses to choose between two unmarked dimension columns', () => {
    const header = ['货号', '总PCS', '长(A)cm', '长(B)cm', '宽cm', '高cm', '毛重KG']
    expect(() => parsePackingListSheet([header, ['F1', 10, 1, 2, 3, 4, 5]])).toThrow(/Ambiguous length/)
  })

  it('treats a quantities-only sheet as valid, with null cartons', () => {
    const parsed = parsePackingListSheet([['货号', 'QTY'], ['F123456', 48]])
    expect(parsed.unitNote).toBeNull()
    expect(parsed.lines[0]).toMatchObject({ sku: 'F123456', qtyShipped: 48, caseLengthIn: null })
  })

  // The 2026-08 arrival lists up to ETD 0803 carry BOTH columns: 总PCS is the
  // line total, Qty/cs is pieces per case. A plain 'qty' substring matches
  // 'Qty/cs', so before QTY_COLUMN_ALTERNATIVES was ordered and filtered this
  // staged P273842's 900 pieces as 18 — silently, with a plausible number.
  // Header text is verbatim from that file, newline inside 箱数 and all.
  it('prefers 总PCS over a Qty/cs column that means pieces per case', () => {
    const header = ['货号', 'UPC', 'Qty/cs', '箱数\r\nCTN', '总PCS']
    const parsed = parsePackingListSheet([header, ['P273842', '0712345678901', 18, 50, 900]])

    expect(parsed.lines[0]).toMatchObject({ sku: 'P273842', qtyShipped: 900 })
  })

  it('ignores case in the Qty/cs header it refuses', () => {
    for (const label of ['qty/cs', 'QTY/CS', 'Qty/Cs']) {
      const parsed = parsePackingListSheet([['货号', label, '总PCS'], ['P1', 18, 900]])
      expect(parsed.lines[0].qtyShipped).toBe(900)
    }
  })

  // Only Qty/cs and no 总PCS is a sheet whose line total simply isn't there.
  // Refusing beats registering pieces-per-case as the received quantity.
  it('refuses a sheet whose only quantity column is Qty/cs', () => {
    expect(() => parsePackingListSheet([['货号', 'Qty/cs'], ['P1', 18]]))
      .toThrow(/Could not find a piece-count column/)
  })

  // Qty/cs sits to the LEFT of the real QTY here: taking the leftmost 'qty'
  // match and giving up would miss the usable column.
  it('looks past a disqualified Qty/cs to a real QTY further right', () => {
    const parsed = parsePackingListSheet([['货号', 'Qty/cs', 'QTY'], ['P1', 18, 900]])
    expect(parsed.lines[0].qtyShipped).toBe(900)
  })

  it('throws when the header is found but every line below it is unusable', () => {
    expect(() => parsePackingListSheet(sheet([['F1', '1', 'n/a', 1, 1, 1, 1]]))).toThrow(/no usable line items/)
  })
})

describe('groupLinesBySku', () => {
  it('sums quantities for a SKU split across cartons, case-insensitively', () => {
    const parsed = parsePackingListSheet(
      sheet([
        ['F123456', '0712345678901', 100, 50, 25, 25, 10],
        ['f123456', null, 44, 50, 25, 25, 10],
        ['F999999', '2', 10, 50, 25, 25, 10],
      ]),
    )
    const grouped = groupLinesBySku(parsed.lines)

    expect(grouped).toHaveLength(2)
    expect(grouped[0]).toMatchObject({ sku: 'F123456', qtyShipped: 144, barcodeFromFile: '0712345678901' })
  })
})

describe('normalizeBarcode', () => {
  // The leading-zero gap is documented in
  // docs/memory/reference-barcode-backfill-handoff.md — a sheet's UPC and the
  // stored barcode routinely differ only by stripped zeros, which must not
  // read as a mismatch.
  it('compares digits with leading zeros stripped', () => {
    expect(normalizeBarcode('0712345678901')).toBe(normalizeBarcode('712345678901'))
    expect(normalizeBarcode(712345678901)).toBe('712345678901')
    expect(normalizeBarcode(null)).toBe('')
  })

  // Real value off container EGSU1396926's arrival list, where T641449's UPC
  // is typed with spaces inside it. Before this, the spaces survived and the
  // line was excluded from apply as a barcode_mismatch against an identical
  // stored barcode.
  it('ignores whitespace typed inside a UPC', () => {
    expect(normalizeBarcode('6  8140239892 8')).toBe(normalizeBarcode('681402398928'))
  })
})

// ── Real supplier file ────────────────────────────────────────────────────
//
// The port's whole purpose is to behave identically to
// scripts/import-packing-list.mjs, which was confirmed against this container
// on 2026-09-14: 27 line items, zero rejections. Skipped when the OneDrive
// folder isn't mounted, so this suite still passes on another machine.
//
// PARSE ONLY. This container shipped in 2023 and its stock was long since
// received and sold — applying it would inject phantom inventory, which is
// exactly what the receiving screen's confirmation gate exists to prevent.
const REAL_FILE =
  'C:/Users/Dragon/OneDrive - L&Y USA/L&Y/L&Y/import documents/2023-11 ETD 1031 397ctn Original List ETA 11-14-2023 CNTR#EMCU8402359 by Round MBL#EGLV143355507278 HBL#RWRD102300024323 gift box.xls'

// The 2026 supplier files name the piece count 总PCS and have no English QTY
// column at all — the parser threw on them until QTY_COLUMN_ALTERNATIVES
// existed. Both the Arrival List and the Original List for this container
// share that shape, which is why both are checked: "Arrival List" was
// previously assumed to be PDF-only and unusable.
const DIR_2026 = 'C:/Users/Dragon/OneDrive - L&Y USA/L&Y/L&Y/import documents'
const BASE_2026 =
  '2026-08 ETD 0826 738ctn KIND ETA 09-08-2026 Cntr#EGSU9522424 MBL#EGLV143655274724 HBL#RWRD102613031248.xlsx'
const file2026 = (kind: string) => `${DIR_2026}/${BASE_2026.replace('KIND', kind)}`

describe.skipIf(!fs.existsSync(file2026('Arrival List')))('real container EGSU9522424 (总PCS format)', () => {
  for (const kind of ['Arrival List', 'Original List']) {
    it(`parses the ${kind}`, () => {
      const wb = XLSX.readFile(file2026(kind))
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }) as SheetRow[]
      const parsed = parsePackingListSheet(rows)

      expect(parsed.problems).toEqual([])
      expect(parsed.lines.length).toBeGreaterThan(20)
      expect(parsed.unitNote).toMatch(/weight in kg/)

      // Colour-suffixed SKUs are normal here (F288023-WN, F288024-PINK) and
      // must survive verbatim — they're distinct sellable products.
      expect(parsed.lines.some((l) => l.sku.includes('-'))).toBe(true)

      const grouped = groupLinesBySku(parsed.lines)
      const totalPieces = grouped.reduce((sum, l) => sum + l.qtyShipped, 0)
      expect(totalPieces).toBeGreaterThan(1000)
      for (const line of grouped) {
        expect(Number.isInteger(line.qtyShipped)).toBe(true)
        expect(line.qtyShipped).toBeGreaterThan(0)
      }
    })
  }
})

describe.skipIf(!fs.existsSync(REAL_FILE))('real container EMCU8402359', () => {
  it('matches the 27 line items the .mjs script found, with no rejections', () => {
    const wb = XLSX.readFile(REAL_FILE)
    let parsed: ReturnType<typeof parsePackingListSheet> | null = null

    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null }) as SheetRow[]
      const hasSkuHeader = rows
        .slice(0, 10)
        .some((r) => Array.isArray(r) && r.some((c) => typeof c === 'string' && c.includes('货号')))
      if (hasSkuHeader) {
        parsed = parsePackingListSheet(rows)
        break
      }
    }

    expect(parsed).not.toBeNull()
    expect(parsed!.problems).toEqual([])
    expect(parsed!.lines).toHaveLength(27)
    expect(parsed!.unitNote).toMatch(/weight in kg/)

    for (const line of parsed!.lines) {
      expect(line.sku).toMatch(/^F\d+$/)
      expect(line.qtyShipped).toBeGreaterThan(0)
      expect(Number.isInteger(line.qtyShipped)).toBe(true)
    }
  })
})
