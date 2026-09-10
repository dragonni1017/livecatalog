// build-missing-image-worklist.mjs
// Run with: node scripts/build-missing-image-worklist.mjs
//
// Consolidated, decision-ready worklist for the 868 catalog products
// missing image_url (built earlier this session via
// check-image-coverage-for-missing-catalog.mjs -> missing-catalog-images-
// coverage.xlsx). Re-reads live Supabase state (not a stale snapshot) and
// merges it with that coverage file's per-SKU fillable/variant/none
// classification, then splits into 4 sheets ordered by what actually
// needs doing:
//
//   1. Visible & Missing (URGENT)     -- active, NOT hidden: shoppers can
//                                        see these with a blank image right
//                                        now.
//   2. Hidden - Fillable Now          -- manually_hidden, but a real image
//                                        already exists in some source
//                                        (Cloudinary CSV, live account,
//                                        etc.) -- a DB write away, IF also
//                                        un-hidden.
//   3. Hidden - Variant Image Only    -- a sibling color/size variant has
//                                        an image; needs a visual check
//                                        before reuse, not an auto-fill.
//   4. Hidden - No Image Anywhere     -- needs an actual new photo.
//
// Read-only. Writes a NEW xlsx to
// data/qbd-catalog-compare/missing-image-worklist.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const COVERAGE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'missing-catalog-images-coverage.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'missing-image-worklist.xlsx')

async function loadCatalog() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('products')
      .select('sku, name, image_url, is_active, manually_hidden, created_at, category:categories!products_category_id_fkey(name)')
      .range(from, from + PAGE - 1)
    if (error) { console.error(error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

function loadCoverageMap() {
  if (!fs.existsSync(COVERAGE_XLSX)) {
    console.warn(`Coverage file not found at ${COVERAGE_XLSX} -- run check-image-coverage-for-missing-catalog.mjs first. Continuing without fillable/variant detail.`)
    return new Map()
  }
  const wb = XLSX.readFile(COVERAGE_XLSX)
  const map = new Map()
  for (const sheetName of ['Fillable Now', 'Variant Only', 'No Image']) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })
    for (const r of rows) map.set(r.sku, { sheet: sheetName, ...r })
  }
  return map
}

function main() {
  console.log('Loading live Supabase catalog...')
  return loadCatalog().then((products) => {
    const missing = products.filter((p) => !p.image_url || !String(p.image_url).trim())
    console.log(`Live: ${products.length} products, ${missing.length} missing image_url`)

    const coverage = loadCoverageMap()
    console.log(`Coverage detail loaded for ${coverage.size} SKUs`)

    const visibleUrgent = []
    const hiddenFillable = []
    const hiddenVariant = []
    const hiddenNone = []

    for (const p of missing) {
      const cov = coverage.get(p.sku)
      const row = {
        sku: p.sku,
        product_name: p.name,
        category: p.category?.name || '(none)',
        created_at: p.created_at ? String(p.created_at).slice(0, 10) : '',
        manually_hidden: p.manually_hidden,
        match_type: cov?.match_type || '',
        source: cov?.source || '',
        candidate_image_ref: cov?.image_ref || '',
      }

      if (p.is_active && !p.manually_hidden) {
        visibleUrgent.push(row)
        continue
      }
      // hidden (or inactive) -- bucket by what the coverage check found
      if (cov?.sheet === 'Fillable Now') hiddenFillable.push(row)
      else if (cov?.sheet === 'Variant Only') hiddenVariant.push(row)
      else hiddenNone.push(row)
    }

    console.log(`\nVisible & Missing (URGENT):     ${visibleUrgent.length}`)
    console.log(`Hidden - Fillable Now:           ${hiddenFillable.length}`)
    console.log(`Hidden - Variant Image Only:     ${hiddenVariant.length}`)
    console.log(`Hidden - No Image Anywhere:      ${hiddenNone.length}`)

    const wbOut = XLSX.utils.book_new()
    const mk = (data) => {
      const ws = XLSX.utils.json_to_sheet(data)
      ws['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 36 }, { wch: 60 }]
      ws['!autofilter'] = { ref: ws['!ref'] }
      return ws
    }

    const summaryRows = [
      { metric: 'Total catalog products', value: products.length },
      { metric: 'Missing image_url', value: missing.length },
      { metric: '', value: '' },
      { metric: '1. Visible & Missing (URGENT -- shoppers see this)', value: visibleUrgent.length },
      { metric: '2. Hidden - Fillable Now (image exists, DB write away)', value: hiddenFillable.length },
      { metric: '3. Hidden - Variant Image Only (needs visual confirm)', value: hiddenVariant.length },
      { metric: '4. Hidden - No Image Anywhere (needs a real photo)', value: hiddenNone.length },
    ]
    const sumWs = XLSX.utils.json_to_sheet(summaryRows)
    sumWs['!cols'] = [{ wch: 55 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wbOut, sumWs, 'Summary')
    XLSX.utils.book_append_sheet(wbOut, mk(visibleUrgent), '1. Visible URGENT')
    XLSX.utils.book_append_sheet(wbOut, mk(hiddenFillable), '2. Hidden Fillable Now')
    XLSX.utils.book_append_sheet(wbOut, mk(hiddenVariant), '3. Hidden Variant Only')
    XLSX.utils.book_append_sheet(wbOut, mk(hiddenNone), '4. Hidden No Image')

    fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
    XLSX.writeFile(wbOut, OUT_XLSX)
    console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)

    console.log('\n--- Visible URGENT (full list) ---')
    visibleUrgent.forEach((r) => console.log(`  ${r.sku} | ${r.product_name} | cat: ${r.category}`))
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
