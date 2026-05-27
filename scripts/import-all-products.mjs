// import-all-products.mjs
// Run with: node scripts/import-all-products.mjs
// Parses ALL products from the Erply Excel and updates lib/products-data.json

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Config ────────────────────────────────────────────────────────────────────

// Put your Excel file path here (relative to project root)
const EXCEL_PATH = process.argv[2] || resolve(__dirname, '..', 'Erply_Product_Import_WithImages_pcsCS04-07-2026.xlsx')
const OUTPUT_PATH = resolve(__dirname, '..', 'lib', 'products-data.json')

// ── Category normalization ────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Merge obvious duplicate category names
const CATEGORY_ALIASES = {
  'artifical flowers': 'artificial flowers',
  'artifical flower': 'artificial flowers',
  'artificial flower': 'artificial flowers',
  'silk flowers': 'artificial flowers',
  'flower arrangement': 'flower arrangements',
  'flower arrangements': 'flower arrangements',
  'xmas': 'christmas',
  'x-mas': 'christmas',
  'christmas items': 'christmas',
  'halloween items': 'halloween',
  'easter items': 'easter',
}

function normalizeCategory(raw) {
  if (!raw) return 'Uncategorized'
  const lower = raw.trim().toLowerCase()
  return CATEGORY_ALIASES[lower]
    ? CATEGORY_ALIASES[lower].replace(/\b\w/g, c => c.toUpperCase())
    : raw.trim().replace(/\b\w/g, c => c.toUpperCase())
}

// ── Parse Excel ───────────────────────────────────────────────────────────────

if (!existsSync(EXCEL_PATH)) {
  console.error(`Excel file not found: ${EXCEL_PATH}`)
  console.error('Usage: node scripts/import-all-products.mjs [path/to/excel.xlsx]')
  process.exit(1)
}

console.log(`Reading Excel: ${EXCEL_PATH}`)
const wb = XLSX.readFile(EXCEL_PATH)
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

const headers = rows[0]
const dataRows = rows.slice(1).filter(r => r[0]) // skip empty rows

console.log(`Found ${dataRows.length} products`)

// Column indices based on headers
// Code, Image, Standardized Name, UPC/Barcode, Suggested Product Group,
// Net Sales Price, Base Unit, UOM, ea/Inner, Inners/Case, Purchase Unit, ...
const COL = {
  sku:       headers.indexOf('Code'),
  name:      headers.indexOf('Standardized Name'),
  category:  headers.indexOf('Suggested Product Group'),
  price:     headers.indexOf('Net Sales Price'),
  uom:       headers.indexOf('UOM'),
  eaInner:   headers.indexOf('ea/Inner'),
  innersCase:headers.indexOf('Inners/Case'),
  purchUnit: headers.indexOf('Purchase Unit'),
}

// ── Build categories ──────────────────────────────────────────────────────────

const rawCategories = [...new Set(dataRows.map(r => r[COL.category]).filter(Boolean))]
const normalizedCatNames = [...new Set(rawCategories.map(normalizeCategory))]

const categories = normalizedCatNames.sort().map((name, idx) => ({
  id: `cat-${(idx + 1).toString().padStart(3, '0')}`,
  name,
  slug: slugify(name),
}))

// Build lookup: normalized name -> category id
const catIdByName = {}
categories.forEach(c => { catIdByName[c.name] = c.id })

console.log(`Built ${categories.length} categories`)

// ── Build products ────────────────────────────────────────────────────────────

// Load existing products-data to preserve any image_urls already set
let existingImageUrls = {}
if (existsSync(OUTPUT_PATH)) {
  try {
    const existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'))
    existing.products.forEach(p => {
      if (p.image_url) existingImageUrls[p.sku] = p.image_url
    })
    console.log(`Preserving ${Object.keys(existingImageUrls).length} existing image URLs`)
  } catch {}
}

const products = dataRows.map((row, idx) => {
  const sku = String(row[COL.sku] || '').trim()
  const name = String(row[COL.name] || '').trim()
  const rawCat = row[COL.category]
  const normalCatName = rawCat ? normalizeCategory(String(rawCat)) : 'Uncategorized'
  const categoryId = catIdByName[normalCatName] || null

  // Price: stored as dollars in Excel, convert to cents
  const priceRaw = parseFloat(row[COL.price]) || 0
  const priceCents = Math.round(priceRaw * 100)

  // Build description from pack info
  const eaInner = row[COL.eaInner]
  const innersCase = row[COL.innersCase]
  const purchUnit = row[COL.purchUnit]
  let description = ''
  if (eaInner && innersCase && purchUnit) {
    description = `${eaInner} pcs/inner · ${innersCase} inners/case · ${purchUnit}`
  } else if (purchUnit) {
    description = String(purchUnit)
  }

  return {
    id: `prod-${(idx + 1).toString().padStart(5, '0')}`,
    sku,
    name,
    description: description || null,
    price_cents: priceCents,
    category_id: categoryId,
    stock_qty: 999,
    image_url: existingImageUrls[sku] || null,
    is_active: true,
  }
})

console.log(`Built ${products.length} products`)

// ── Write output ──────────────────────────────────────────────────────────────

const output = { categories, products }
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2))

console.log(`\n✅ Done! lib/products-data.json updated`)
console.log(`   ${categories.length} categories`)
console.log(`   ${products.length} products`)
console.log(`   ${products.filter(p => p.image_url).length} products with images`)
console.log(`\nNext: run the Cloudinary sync to fill in more images`)
console.log(`  node scripts/sync-cloudinary.mjs`)
