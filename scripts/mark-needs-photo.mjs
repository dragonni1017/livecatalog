// mark-needs-photo.mjs
// Run with: node scripts/mark-needs-photo.mjs
//
// Sets products.needs_photo = true for every SKU listed in
// data/images/genuinely-no-image.csv (the output of
// scripts/find-truly-missing-images.mjs -- SKUs with no image in Erply,
// WooCommerce, Cloudinary/Supabase, or the GoDaddy archive).
//
// Requires migration 0023_products_needs_photo.sql to already be applied
// (products.needs_photo column must exist) -- run that in the Supabase SQL
// editor first.
//
// Only sets the flag to true for SKUs in the CSV; does not clear it for
// anyone else. Safe to re-run.
//
// Requires in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

config({ path: path.join(ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials in .env.local (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const CSV_PATH = path.join(ROOT, 'data', 'images', 'genuinely-no-image.csv')

function parseCsvLine(line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line)
    const row = {}
    header.forEach((h, i) => (row[h] = cols[i]))
    return row
  })
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Missing ${CSV_PATH} -- run scripts/find-truly-missing-images.mjs first.`)
    process.exit(1)
  }

  const skus = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'))
    .map((r) => r.sku)
    .filter(Boolean)
  console.log(`Read ${skus.length} SKUs from ${path.relative(ROOT, CSV_PATH)}`)

  // Chunk the .in() filter -- PostgREST/Supabase has a practical URL length
  // limit, and 862 SKUs in one IN-list is pushing it.
  const CHUNK = 200
  let updated = 0
  const notFound = []

  for (let i = 0; i < skus.length; i += CHUNK) {
    const chunk = skus.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('products')
      .update({ needs_photo: true })
      .in('sku', chunk)
      .select('sku')
    if (error) {
      console.error(`Update failed for chunk starting at ${i}:`, error.message)
      process.exit(1)
    }
    updated += data.length
    const foundSkus = new Set(data.map((r) => r.sku))
    for (const sku of chunk) if (!foundSkus.has(sku)) notFound.push(sku)
    console.log(`  updated ${data.length}/${chunk.length} (running total ${updated})`)
  }

  console.log(`\nDone. needs_photo=true set on ${updated} products.`)
  if (notFound.length) {
    console.log(`${notFound.length} SKUs from the CSV have no matching row in Supabase (not in this catalog's DB):`)
    console.log('  ' + notFound.slice(0, 20).join(', ') + (notFound.length > 20 ? ', ...' : ''))
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
