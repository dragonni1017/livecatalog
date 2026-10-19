// LYUSA item-import export: the 84-column layout of
// ALL21_products_LYUSA_template_v2.csv. Pure helpers shared by
// scripts/lyusa-batch.ts (build a batch) and scripts/lyusa-mark-sent.ts
// (record it in lyusa_submissions, migration 0065).
//
// A row copies every column the template holds constant (WHS#, Lot#, the
// zero / "  /  /" placeholders...) from the template's first row. Per product:
//   Item#, Description, Unit, Price3 (live catalog price), Create Date,
//   Class# / Dept#, Image Name (Z:\Pic\<SKU>.jpg), Unit/Case, Default Unit,
//   UPC Code, Case Wt.
// Description follows the template's two styles, built from the name's pack
// spec "<pk>/pk <bx>bx/cs cs.<N>" (docs/PRODUCT-NAMING-STANDARD.md):
//   single unit per case side:  "<Name> - 20/cs - 29" x 22" x 16" - 33lbs - cs.20"  (Default Unit PC)
//   packs of several pieces:    "<Name> - 12/pk - 20pk/cs - case dim. 31" x 18" x 16" - 26lbs"  (Default Unit CS)

// Catalog category -> [Dept#, Class#]. Codes are the ones the template uses.
export const CATEGORY_CODES: Record<string, [string, string]> = {
  'Papers': ['FLORAL SUP', 'PAPER'],
  'Mesh Paper': ['FLORAL SUP', 'PAPER'],
  'Floral Supplies': ['FLORAL SUP', 'FLSUP'],
  'Leis': ['FLORAL SUP', 'FLSUP'],
  'Dome': ['FLORAL SUP', 'FLSUP'],
  'Floral Boxes': ['FLORAL SUP', 'FLBOX'],
  'Floral Basket': ['FLORAL SUP', 'BASKT'],
  'Flowers': ['FLORAL SUP', 'FLOWR'],
  'Flower Spray': ['FLORAL SUP', 'FLOWR'],
  'Ribbons': ['FLORAL SUP', 'RIBBN'],
  'Bows': ['FLORAL SUP', 'RIBBN'],
  'Crowns': ['FLORAL SUP', 'CROWN'],
  'Gift Bags': ['FLORAL SUP', 'GIFTB'],
  'Plush': ['TOYS', 'PLUSH'],
  'Toys & Novelties': ['TOYS', 'NOVEL'],
  '3D Printed': ['TOYS', 'NOVEL'],
  'Keychains': ['GEN MERCH', 'KEYCH'],
  'Stationery & Office': ['GEN MERCH', 'STATI'],
  'Drinkware & Cups': ['GEN MERCH', 'DRINK'],
  'Plate Set': ['GEN MERCH', 'DRINK'],
  'Beauty & Personal Care': ['GEN MERCH', 'BEAUT'],
  'Fan': ['GEN MERCH', 'FAN'],
  'Lamps': ['GEN MERCH', 'LAMP'],
  'Humidifier': ['GEN MERCH', 'LAMP'],
  'Crochet': ['GEN MERCH', 'CROCH'],
  'Bags/Purses': ['GEN MERCH', 'BAGS'],
  'LED': ['GEN MERCH', 'LED'],
  'Candy': ['GEN MERCH', 'CANDY'],
  'Accessories & Apparel': ['GEN MERCH', 'ACCES'],
  'Umbrella': ['GEN MERCH', 'ACCES'],
  'Speakers': ['GEN MERCH', 'ACCES'],
  'Picture Frames': ['GEN MERCH', 'ACCES'],
  'Candles': ['GEN MERCH', 'ACCES'],
  'Blankets': ['GEN MERCH', 'ACCES'],
  'Seasonal & Holiday': ['SEASONAL', 'SEASO'],
  'Deco': ['SEASONAL', 'SEASO'],
}

// Same pattern as public.product_pack_match (migration 0054).
const PACK_RE = /\s*-\s*(\d+)\s*\/pk\s+(\d+)\s*bx\/cs(?:\s+cs\.(\d+)\s*(pk|bx|set|pcs|pc)?)?\s*$/i
// Template description dims/weight, e.g. 29" x 22" x 16" - 33lbs
const TPL_DIMS_RE = /([\d.]+)"\s*x\s*([\d.]+)"\s*x\s*([\d.]+)"/
const TPL_WT_RE = /([\d.]+)\s*lbs/i

// Batch folder names: data/lyusa/batches/<name>/. Kept to a safe charset so a
// name can't escape the folder.
export const BATCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export interface LyusaProduct {
  sku: string
  name: string
  barcode: string | null
  price_cents: number
  case_pieces: number | null
  sold_by: string | null
  case_length_in: number | null
  case_width_in: number | null
  case_height_in: number | null
  case_weight_lb: number | null
}

export type TemplateRow = Record<string, string>
export interface SupplierFacts { pieces: number | null; upc: string }

export const normSku = (sku: string) => sku.trim().toUpperCase()
const num = (v: number | string) => String(Number(Number(v).toFixed(2)))
const unitCode = (n: number) => (n < 100 ? `CS${n}` : `C${n}`)
export const csvQuote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

// Matches the template: UTF-8 with BOM, CRLF, every field quoted.
export function toCsv(rows: unknown[][]): string {
  return '\uFEFF' + rows.map((r) => r.map(csvQuote).join(',')).join('\r\n') + '\r\n'
}

// M/D/YYYY, the template's Create Date format (written with a leading space).
export function lyusaDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

export function buildRow(
  p: LyusaProduct,
  tpl: TemplateRow | undefined,
  codes: [string, string] | undefined,
  today: string,
  facts: SupplierFacts | undefined,
): Record<string, string> {
  const m = p.name.match(PACK_RE)
  const base = m ? p.name.slice(0, m.index).trim() : p.name.trim()
  const pk = m ? Number(m[1]) : null
  const bx = m ? Number(m[2]) : null
  // No pack spec in the name: fall back to the supplier's pieces per carton.
  const factPieces = !m && facts?.pieces ? facts.pieces : null
  const pieces = p.case_pieces ?? (m ? pk! * bx! : factPieces)

  let dims: (number | string)[] | null = p.case_length_in
    ? [p.case_length_in, p.case_width_in ?? 0, p.case_height_in ?? 0]
    : null
  let wt: number | string | null = p.case_weight_lb
  if (tpl) {
    const td = tpl.Description.match(TPL_DIMS_RE)
    const tw = tpl.Description.match(TPL_WT_RE)
    if (!dims && td) dims = [td[1], td[2], td[3]]
    if (!wt && tw) wt = tw[1]
  }
  const dimStr = dims ? `${num(dims[0])}" x ${num(dims[1])}" x ${num(dims[2])}"` : ''
  const wtStr = wt ? `${num(wt)}lbs` : ''

  // Several pieces per pack AND several packs per case: the "pk/pk - bxpk/cs"
  // style, sold by the case. Otherwise one figure per case, sold by the piece.
  const multiPack = !!m && ((pk! > 1 && bx! > 1) || p.sold_by === 'pack')
  let description
  if (!m && factPieces) {
    description = [base, `${factPieces}/cs`, dimStr, wtStr, `cs.${factPieces}`].filter(Boolean).join(' - ')
  } else if (!m) {
    description = [base, dimStr, wtStr].filter(Boolean).join(' - ')
  } else if (multiPack) {
    description = [base, `${pk}/pk`, `${bx}pk/cs`, dimStr && `case dim. ${dimStr}`, wtStr].filter(Boolean).join(' - ')
  } else {
    description = [base, `${pieces}/cs`, dimStr, wtStr, `cs.${pieces}`].filter(Boolean).join(' - ')
  }

  // No pack spec in the name, but the template has this SKU: keep its
  // description and case units rather than dropping them.
  const useTpl = !m && tpl && tpl.Unit
  return {
    'Item#': p.sku,
    Description: useTpl ? tpl.Description : description,
    Unit: useTpl ? tpl.Unit : pieces ? unitCode(pieces) : '',
    Price3: num(p.price_cents / 100),
    'Create Date': ` ${today}`,
    'Dept#': codes ? codes[0] : '',
    'Class#': codes ? codes[1] : '',
    'Image Name': `Z:\\Pic\\${p.sku}.jpg`,
    'Unit/Case': useTpl ? tpl['Unit/Case'] : String(pieces ?? ''),
    'Default Unit': useTpl ? tpl['Default Unit'] : multiPack ? 'CS' : 'PC',
    'UPC Code': p.barcode || tpl?.['UPC Code'] || facts?.upc || '',
    'Case Wt': wt ? num(wt) : '0',
  }
}

// Template columns in order, each filled from the row or the template filler.
export function rowValues(header: string[], row: Record<string, string>, filler: TemplateRow): string[] {
  return header.map((h) => (h in row ? row[h] : filler[h] ?? ''))
}

// Why a built row needs a look before it goes out. Empty = fine.
export function attentionReasons(row: Record<string, string>, hasPhoto: boolean): string[] {
  const out: string[] = []
  if (!row['Class#']) out.push('no Class#/Dept#')
  if (!row.Unit) out.push('no pack size (Unit blank)')
  if (row['Case Wt'] === '0') out.push('no case weight')
  if (!hasPhoto) out.push('no photo')
  return out
}

// Split files (already in output order) into zip parts of at most `limit`
// bytes each. A single file bigger than the limit gets a part to itself.
export function splitIntoParts<T extends { size: number }>(files: T[], limit: number): T[][] {
  const parts: T[][] = []
  let cur: T[] = []
  let size = 0
  for (const f of files) {
    if (cur.length && size + f.size > limit) {
      parts.push(cur)
      cur = []
      size = 0
    }
    cur.push(f)
    size += f.size
  }
  if (cur.length) parts.push(cur)
  return parts
}
