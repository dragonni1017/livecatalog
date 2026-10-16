import { afterEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

// xlsx comes from the official SheetJS CDN (0.20.3), not npm, which stopped at
// the vulnerable 0.18.5. These pin the behaviour the app relies on.

afterEach(() => {
  // Undo any pollution so one failure can't cascade into other tests.
  delete (Object.prototype as Record<string, unknown>).polluted
})

const workbookFrom = (aoa: unknown[][]) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1')
  return wb
}

describe('xlsx version', () => {
  // This is what actually pins the security fix: the advisories (prototype
  // pollution < 0.19.3, ReDoS < 0.20.2) need specially crafted files to
  // reproduce, which these tests don't attempt.
  it('is the patched SheetJS release', () => {
    // `version` exists at runtime but isn't in SheetJS's type definitions.
    const version = (XLSX as unknown as { version: string }).version
    const [maj, min, patch] = version.split('.').map(Number)
    expect(maj * 10000 + min * 100 + patch).toBeGreaterThanOrEqual(2003) // >= 0.20.3
  })
})

describe('hostile header names (general guard, not a CVE reproduction)', () => {
  // Passes on 0.18.5 too; it guards against header names reaching
  // Object.prototype through sheet_to_json, not the crafted-file advisory.
  it('a sheet with __proto__ / constructor headers does not touch Object.prototype', () => {
    const wb = workbookFrom([
      ['__proto__', 'constructor', 'sku'],
      ['{"polluted":true}', 'x', 'F1'],
    ])
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.read(buf, { type: 'array' }).Sheets.Sheet1)
    expect(rows).toHaveLength(1)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('round trip the way the app uses it', () => {
  // Order Excel export writes a buffer; receiving/import screens read { type: 'array' }.
  const aoa = [
    ['SKU', 'Barcode', 'Qty', 'Price', 'Name'],
    ['F287957', '073787910121', 60, 12.25, 'Moonrise Floral Paper Burgundy - 20/pk 60bx/cs cs.60'],
    ['K229480', '73787910121', 1, 0.5, 'Line one\nline two'],
  ]

  it('keeps leading-zero barcodes, numbers and multi-line text (header:1, defval:null)', () => {
    const buf = XLSX.write(workbookFrom(aoa), { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const back = XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(buf), { type: 'array' }).Sheets.Sheet1, { header: 1, defval: null })
    expect(back).toEqual(aoa)
  })

  it('object rows with raw:false format numbers as text', () => {
    const buf = XLSX.write(workbookFrom(aoa), { type: 'array', bookType: 'xlsx' })
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(XLSX.read(buf, { type: 'array' }).Sheets.Sheet1, { raw: false })
    expect(rows[0]).toMatchObject({ SKU: 'F287957', Barcode: '073787910121', Qty: '60' })
  })
})

describe('CSV ISO timestamps (known 0.18 → 0.20 change)', () => {
  // 0.20 turns ISO date-time text in a CSV into an Excel date number by
  // default; 0.18 left it as text. App uploads are .xlsx/.xls only, and the
  // scripts that read CSVs use { raw: true }, which keeps the text.
  const csv = 'sku,at\nF1,2026-10-06T16:26:37.218Z\n'
  it('default parse converts it to a date serial', () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.read(csv, { type: 'string' }).Sheets.Sheet1)
    expect(typeof rows[0].at).toBe('number')
  })
  it('{ raw: true } keeps it as text', () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.read(csv, { type: 'string', raw: true }).Sheets.Sheet1)
    expect(rows[0].at).toBe('2026-10-06T16:26:37.218Z')
  })
})
