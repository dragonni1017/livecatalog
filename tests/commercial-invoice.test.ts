import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { createRequire } from 'module'
import {
  baseSku,
  CommercialInvoiceError,
  joinInvoiceToLines,
  parseCommercialInvoiceSheet,
  proposeDescriptor,
  suffixLabel,
  type InvoiceLine,
} from '@/lib/commercial-invoice'
import { parsePackingListSheet, groupLinesBySku, type SheetRow } from '@/lib/packing-list'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XLSX: any = require('xlsx')

// Mirrors the real sheet: letterhead rows, header at an arbitrary depth, an
// empty Item# column, then a Total row that closes the table.
const INVOICE_SHEET: SheetRow[] = [
  ['Some Supplier Co, Ltd', null, null, null, null, null, null, null, null, null],
  [null, null, 'COMMERCIAL INVOICE', null, null, null, null, null, null, null],
  ['#', 'Item#', 'Descriptions of Goods', null, null, null, 'PACKAGE (ctns)', 'QUANTITY (pcs)', 'UNIT (USD)', 'AMOUNT   (USD)'],
  [1, null, 'Flower Decorative 6-in-1  Set  Cylinder Style   25cm - 100%Set', null, null, null, 50, 600, 1.9, 1140],
  [2, null, 'Squeeze Toy Giant Drumstick Style - 100%TPR', null, null, null, 80, 1920, 0.75, 1440],
  [3, null, null, null, null, null, null, null, null, null],
  ['Total', null, null, null, null, null, 130, 2520, null, 2580],
]

describe('parseCommercialInvoiceSheet', () => {
  it('reads the line table and the totals row', () => {
    const { lines, totalCartons, totalPieces } = parseCommercialInvoiceSheet(INVOICE_SHEET)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      lineNo: 1,
      description: 'Flower Decorative 6-in-1 Set Cylinder Style 25cm - 100%Set',
      cartons: 50,
      pieces: 600,
      unitPriceUsd: 1.9,
    })
    expect(totalCartons).toBe(130)
    expect(totalPieces).toBe(2520)
  })

  it('refuses a sheet with no description column', () => {
    expect(() => parseCommercialInvoiceSheet([['Packing List'], ['ctns', 'pcs']])).toThrow(CommercialInvoiceError)
  })
})

describe('baseSku / suffixLabel', () => {
  it('splits colour-suffixed SKUs', () => {
    expect(baseSku('F288023-WN')).toBe('F288023')
    expect(baseSku('F287491')).toBe('F287491')
    expect(suffixLabel('F288023-WN')).toBe('Wine')
    expect(suffixLabel('F288024-CREAM')).toBe('Cream')
    expect(suffixLabel('F287491')).toBeNull()
  })

  it('passes an unknown code through rather than guessing a colour', () => {
    expect(suffixLabel('D751004-NEW')).toBe('NEW')
    expect(suffixLabel('3D801227-STARFISH')).toBe('STARFISH')
  })

  it('reads a size-like suffix as a size', () => {
    expect(suffixLabel('P273840-80CM')).toBe('80cm')
  })
})

describe('joinInvoiceToLines', () => {
  const invoice: InvoiceLine[] = [
    { lineNo: 1, description: 'Flower Decorative 6-in-1 Set', cartons: 50, pieces: 600, unitPriceUsd: 1.9 },
    { lineNo: 2, description: 'Squeeze Toy Giant Drumstick', cartons: 80, pieces: 1920, unitPriceUsd: 0.75 },
  ]

  it('matches a single SKU on cartons and pieces', () => {
    const out = joinInvoiceToLines(invoice, [{ sku: 'S162782', qtyShipped: 1920, cartons: 80 }])
    expect(out[0]).toMatchObject({ sku: 'S162782', invoiceLineNo: 2, basis: 'cartons+pieces' })
  })

  it('fans one invoice row out across a colourway family', () => {
    // The real shape: 15+15+15+5 cartons and 180+180+180+60 pieces = 50/600.
    const out = joinInvoiceToLines(invoice, [
      { sku: 'F288023-WN', qtyShipped: 180, cartons: 15 },
      { sku: 'F288023-BLK', qtyShipped: 180, cartons: 15 },
      { sku: 'F288023-LPK', qtyShipped: 180, cartons: 15 },
      { sku: 'F288023-VLT', qtyShipped: 60, cartons: 5 },
    ])
    expect(out).toHaveLength(4)
    for (const r of out) {
      expect(r.invoiceLineNo).toBe(1)
      expect(r.basis).toBe('family-share')
      expect(r.description).toBe('Flower Decorative 6-in-1 Set')
    }
  })

  it('leaves a line unmatched rather than guessing when nothing reconciles', () => {
    const out = joinInvoiceToLines(invoice, [{ sku: 'X999', qtyShipped: 77, cartons: 3 }])
    expect(out[0]).toMatchObject({ basis: 'none', description: null })
  })

  it('does not hand the same invoice row to two different families', () => {
    const out = joinInvoiceToLines(
      [{ lineNo: 1, description: 'Ambiguous', cartons: 10, pieces: 100, unitPriceUsd: 1 }],
      [
        { sku: 'A111', qtyShipped: 100, cartons: 10 },
        { sku: 'B222', qtyShipped: 100, cartons: 10 },
      ],
    )
    // Two equally good candidates -> neither is claimed.
    expect(out.every((r) => r.basis === 'none')).toBe(true)
  })

  it('falls back to a unique pieces-only match when cartons are absent', () => {
    const out = joinInvoiceToLines(invoice, [{ sku: 'S162782', qtyShipped: 1920, cartons: null }])
    expect(out[0]).toMatchObject({ invoiceLineNo: 2, basis: 'pieces' })
  })
})

describe('proposeDescriptor', () => {
  it('rewrites invoice phrasing and leads with the colour', () => {
    expect(proposeDescriptor('Flower Decorative 6-in-1  Set  Cylinder Style   25cm - 100%Set', 'F288023-WN')).toBe(
      'Wine Flower Decorative 6-in-1 Set Cylinder 25cm',
    )
    expect(proposeDescriptor('Squeeze Toy Giant Drumstick Style - 100%TPR', 'S162782')).toBe(
      'Squeeze Toy Giant Drumstick',
    )
  })

  it('falls back to the suffix alone when there is no invoice description', () => {
    expect(proposeDescriptor(null, 'F288024-CREAM')).toBe('Cream')
    expect(proposeDescriptor(null, 'F287491')).toBe('')
  })
})

// ── Against the real container ────────────────────────────────────────────
const DIR = 'C:/Users/Dragon/OneDrive - L&Y USA/L&Y/L&Y/import documents'
const BASE = '2026-08 ETD 0826 738ctn KIND ETA 09-08-2026 Cntr#EGSU9522424 MBL#EGLV143655274724 HBL#RWRD102613031248.xlsx'
const real = (kind: string) => `${DIR}/${BASE.replace('KIND', kind)}`

describe.skipIf(!fs.existsSync(real('Commercial Invoice')))('real EGSU9522424 invoice', () => {
  it('parses and reconciles against the filename carton count', () => {
    const wb = XLSX.readFile(real('Commercial Invoice'))
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, defval: null }) as SheetRow[]
    const { lines, totalCartons, totalPieces } = parseCommercialInvoiceSheet(rows)

    expect(lines.length).toBeGreaterThan(10)
    // The filename says 738ctn, and so does the invoice's own total row.
    expect(totalCartons).toBe(738)
    expect(lines.reduce((s, l) => s + l.cartons, 0)).toBe(totalCartons)
    expect(lines.reduce((s, l) => s + l.pieces, 0)).toBe(totalPieces)
    for (const l of lines) expect(l.description).not.toMatch(/^\s*$/)
  })

  it('joins the real invoice to the real packing list, colourways included', () => {
    const invWb = XLSX.readFile(real('Commercial Invoice'))
    const invRows = XLSX.utils.sheet_to_json(invWb.Sheets['Sheet1'], { header: 1, defval: null }) as SheetRow[]
    const { lines: invoice } = parseCommercialInvoiceSheet(invRows)

    const plWb = XLSX.readFile(real('Arrival List'))
    const plRows = XLSX.utils.sheet_to_json(plWb.Sheets[plWb.SheetNames[0]], { header: 1, defval: null }) as SheetRow[]
    const shipment = groupLinesBySku(parsePackingListSheet(plRows).lines)

    const joined = joinInvoiceToLines(
      invoice,
      shipment.map((l) => ({ sku: l.sku, qtyShipped: l.qtyShipped, cartons: l.cartons })),
    )

    const matched = joined.filter((j) => j.basis !== 'none')
    // Most of the container should resolve; the rest is the admin's to fill.
    expect(matched.length).toBeGreaterThan(shipment.length / 2)

    // The F288023 colourways must be treated as one unit — every member gets
    // the same outcome, never a mix of descriptions.
    const family = joined.filter((j) => j.sku.startsWith('F288023'))
    if (family.length > 1) {
      expect(new Set(family.map((f) => f.basis)).size).toBe(1)
      expect(new Set(family.map((f) => f.description)).size).toBe(1)

      // In THIS container that outcome is 'ambiguous', not a match: the
      // family totals 50 cartons / 600 pieces, and so does invoice line 23
      // ("Plush Toys Axolotl 60cm") as well as line 1 ("Flower Decorative
      // 6-in-1 Set"). Arithmetic cannot separate them, and an earlier cut of
      // this matcher silently named these florals after the axolotl.
      expect(family[0].basis).toBe('ambiguous')
      expect(family[0].description).toMatch(/AMBIGUOUS/)
      expect(family[0].invoiceLineNo).toBeNull()
    }

    // Nothing may be assigned off a colliding signature.
    const collidingSigs = new Set<string>()
    const seen = new Set<string>()
    for (const l of invoice) {
      const sig = `${l.cartons}/${l.pieces}`
      if (seen.has(sig)) collidingSigs.add(sig)
      seen.add(sig)
    }
    expect(collidingSigs.size).toBeGreaterThan(0) // this container really does have them
    for (const j of joined) {
      if (j.invoiceLineNo == null) continue
      const line = invoice.find((l) => l.lineNo === j.invoiceLineNo)!
      expect(collidingSigs.has(`${line.cartons}/${line.pieces}`)).toBe(false)
    }
  })
})

describe('joinInvoiceToLines — ambiguous signatures', () => {
  // The real EGSU9522424 invoice has five pairs of rows sharing a
  // (cartons, pieces) signature, e.g. 50/600 for both "Flower Decorative
  // 6-in-1 Set" and "Plush Toys Axolotl 60cm". Resolving those by processing
  // order produced two confidently wrong product names.
  const colliding: InvoiceLine[] = [
    { lineNo: 1, description: 'Flower Decorative 6-in-1 Set', cartons: 50, pieces: 600, unitPriceUsd: 1.9 },
    { lineNo: 23, description: 'Plush Toys Axolotl 60cm', cartons: 50, pieces: 600, unitPriceUsd: 4.5 },
    { lineNo: 5, description: 'Squeeze Toy Giant Drumstick', cartons: 80, pieces: 1920, unitPriceUsd: 0.75 },
  ]

  it('refuses to assign either colliding row to an exact single-SKU match', () => {
    const out = joinInvoiceToLines(colliding, [{ sku: 'P273816-60cm', qtyShipped: 600, cartons: 50 }])
    expect(out[0].basis).toBe('ambiguous')
    expect(out[0].invoiceLineNo).toBeNull()
    expect(out[0].description).toMatch(/AMBIGUOUS/)
    // Both candidates are named, so the admin can choose without digging.
    expect(out[0].description).toMatch(/Flower Decorative 6-in-1 Set/)
    expect(out[0].description).toMatch(/Plush Toys Axolotl 60cm/)
  })

  it('refuses a colourway family whose total hits a colliding signature', () => {
    const out = joinInvoiceToLines(colliding, [
      { sku: 'F288023-WN', qtyShipped: 180, cartons: 15 },
      { sku: 'F288023-BLK', qtyShipped: 180, cartons: 15 },
      { sku: 'F288023-LPK', qtyShipped: 180, cartons: 15 },
      { sku: 'F288023-VLT', qtyShipped: 60, cartons: 5 },
    ])
    expect(out).toHaveLength(4)
    for (const r of out) {
      expect(r.basis).toBe('ambiguous')
      expect(r.description).toMatch(/50 cartons \/ 600 pieces/)
    }
  })

  it('still matches unambiguous rows in the same invoice', () => {
    const out = joinInvoiceToLines(colliding, [
      { sku: 'S162782', qtyShipped: 1920, cartons: 80 },
      { sku: 'P273816-60cm', qtyShipped: 600, cartons: 50 },
    ])
    const clean = out.find((r) => r.sku === 'S162782')!
    expect(clean.basis).toBe('cartons+pieces')
    expect(clean.description).toBe('Squeeze Toy Giant Drumstick')
  })
})
