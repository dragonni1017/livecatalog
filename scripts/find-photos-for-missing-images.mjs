// find-photos-for-missing-images.mjs
// Run with: node scripts/find-photos-for-missing-images.mjs
//           node scripts/find-photos-for-missing-images.mjs --root="C:/Users/Dragon/Downloads/New Photos"
//           node scripts/find-photos-for-missing-images.mjs --all        (include products that already have an image)
//           node scripts/find-photos-for-missing-images.mjs --csv        (also write data/photo-matches-<date>.csv)
//
// REPORT ONLY. Answers one question: of the photos sitting on this machine,
// which ones belong to a product that has no image yet?
//
// Walks the whole Downloads tree by default, so a folder dropped anywhere in
// it gets picked up without being named. Uses the same filename->SKU rules as
// upload-container-photos.mjs (both import scripts/photo-matching.mjs), so
// anything reported here is something the uploader will actually match.
//
// Output is grouped by folder and ends with the exact --dir= command to
// upload each one.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readImageFiles, matchFilesToProducts } from './photo-matching.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const rootArg = process.argv.find((a) => a.startsWith('--root='))
const SEARCH_ROOT = rootArg ? rootArg.slice(7).replace(/^"|"$/g, '') : 'C:/Users/Dragon/Downloads'
const INCLUDE_ALL = process.argv.includes('--all')
const WRITE_CSV = process.argv.includes('--csv')

// Directories with no product photos in them, skipped so the walk stays quick
// and the "matched nothing" list stays readable.
const SKIP_DIRS = [
  'livecatalog', 'node_modules', '.git', '.next',
  '05_tools_and_scripts', '06_installers_optional_redownload',
  '03_design_files', '04_email_backup',
]

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SERVICE_KEY)

console.log(`scanning ${SEARCH_ROOT} …`)
const files = readImageFiles([SEARCH_ROOT], { recursive: true, skipDirs: SKIP_DIRS })
console.log(`${files.length} image file(s) found`)

const products = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('products')
    .select('sku, name, image_url, needs_photo, is_active, manually_hidden')
    .range(from, from + 999)
  if (error) { console.error(error.message); process.exit(1) }
  products.push(...(data ?? []))
  if ((data ?? []).length < 1000) break
}
const bySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p]))
const noImage = products.filter((p) => !p.image_url).length
console.log(`${products.length} products, ${noImage} with no image\n`)

const { plan, unmatched } = matchFilesToProducts(files, bySku)

const wanted = [...plan.values()].filter((e) => INCLUDE_ALL || !e.product.image_url)
if (wanted.length === 0) {
  console.log(INCLUDE_ALL
    ? 'No photo on disk matches any product.'
    : 'Nothing to do: every product a local photo matches already has an image.')
} else {
  // Grouped by folder, because that is the unit the uploader takes.
  const byFolder = new Map()
  for (const e of wanted) {
    const dir = (e.primary ?? e.views[0]?.file)?.dir ?? '(unknown)'
    byFolder.set(dir, [...(byFolder.get(dir) ?? []), e])
  }
  console.log(`${wanted.length} product(s) ${INCLUDE_ALL ? 'matched' : 'with NO image that have a photo on disk'}:\n`)
  for (const [dir, entries] of [...byFolder.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${dir}   (${entries.length})`)
    for (const e of entries.sort((a, b) => a.product.sku.localeCompare(b.product.sku))) {
      const files = [e.primary?.name, ...e.views.sort((a, b) => a.n - b.n).map((v) => v.file.name)].filter(Boolean)
      const visible = e.product.is_active && !e.product.manually_hidden ? 'VISIBLE' : 'hidden '
      console.log(`     ${visible}  ${e.product.sku.padEnd(16)} ${files.join(', ')}`)
    }
    console.log(`     -> node scripts/upload-container-photos.mjs --dir="${dir.replace(/\\/g, '/')}" --apply\n`)
  }
}

const matchedExisting = [...plan.values()].length - wanted.length
console.log(`${matchedExisting} more matched a product that already has an image (use --all to list them)`)
console.log(`${unmatched.length} file(s) matched no SKU at all`)

if (WRITE_CSV) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const out = path.join(ROOT, 'data', `photo-matches-${stamp}.csv`)
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const rows = ['sku,has_image,visible,folder,files']
  for (const e of [...plan.values()]) {
    const files = [e.primary?.name, ...e.views.map((v) => v.file.name)].filter(Boolean)
    rows.push([
      e.product.sku,
      e.product.image_url ? 'yes' : 'no',
      e.product.is_active && !e.product.manually_hidden ? 'yes' : 'no',
      esc((e.primary ?? e.views[0]?.file)?.dir ?? ''),
      esc(files.join(' ')),
    ].join(','))
  }
  fs.writeFileSync(out, rows.join('\n') + '\n')
  console.log(`\nCSV: ${path.relative(ROOT, out)}`)
}
