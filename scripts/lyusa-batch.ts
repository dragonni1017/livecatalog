// lyusa-batch.ts
// Run with: npm run lyusa:batch -- [name] [--all] [--no-photos] [--template <csv>]
//
// Builds one LYUSA item-import batch in data/lyusa/batches/<name>/ (name
// defaults to today, YYYY-MM-DD):
//   <name>-products.csv          84-column LYUSA layout (lib/lyusa.ts)
//   <name>-photos-partN.zip      <SKU>.jpg, 1000x1000 sRGB JPEG on white, ~16 MB parts
//   <name>-needs-attention.csv   rows to check first: no Class#, no pack size,
//                                no case weight, no photo
//   batch.json                   what's in it, read by lyusa:mark-sent
//
// Takes every catalog-visible product (is_active, not manually_hidden) that
// isn't in lyusa_submissions yet (migration 0065). --all ignores that and
// exports everything visible, the old export-lyusa-format.mjs behaviour.
//
// READ ONLY against Supabase: building a batch does NOT mark it sent. Once the
// files have actually gone out, run: npm run lyusa:mark-sent -- <name>
//
// Template (default data/lyusa/template.csv, a copy of
// ALL21_products_LYUSA_template_v2.csv) supplies the header, the constant
// columns, and for SKUs already in it: Class#/Dept#, case dims/weight, UPC.
// Class#/Dept# come from data/lyusa-sku-codes.csv first, then the template,
// then CATEGORY_CODES. Pieces per carton and missing UPCs for names with no
// pack spec come from data/lyusa-sku-supplier-facts.csv.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import {
  BATCH_NAME_RE, CATEGORY_CODES, attentionReasons, buildRow, lyusaDate, normSku,
  rowValues, splitIntoParts, toCsv,
  type LyusaProduct, type SupplierFacts, type TemplateRow,
} from '../lib/lyusa.ts'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
// sharp ships with next (not a direct dependency); fine for a local script.
const sharp = require('sharp')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const PART_LIMIT = 16 * 1024 * 1024
const PHOTO_SIZE = 1000
const CONCURRENCY = 12

const args = process.argv.slice(2)
const flag = (f: string) => args.includes(f)
const opt = (f: string) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}
const templatePath = opt('--template') ?? path.join(ROOT, 'data', 'lyusa', 'template.csv')
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--template')
const iso = new Date().toISOString().slice(0, 10)
const name = positional[0] ?? (flag('--all') ? `${iso}-all` : iso)
if (!BATCH_NAME_RE.test(name)) {
  console.error(`Bad batch name "${name}": letters, digits, . _ - only.`)
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

type Product = LyusaProduct & { category_id: string | null; image_url: string | null }

function readCsv(file: string): Record<string, string>[] {
  const wb = XLSX.readFile(file, { raw: true })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' })
}

async function fetchVisibleProducts(): Promise<Product[]> {
  const all: Product[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('sku, name, barcode, price_cents, category_id, image_url, case_pieces, sold_by, case_length_in, case_width_in, case_height_in, case_weight_lb')
      .eq('is_active', true)
      .eq('manually_hidden', false)
      .order('sku')
      .range(from, from + 999)
    if (error) throw new Error(`products read: ${error.message}`)
    all.push(...(data as Product[]))
    if (data.length < 1000) break
  }
  return all
}

async function fetchSentSkus(): Promise<Set<string>> {
  const sent = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('lyusa_submissions').select('sku').order('sku').range(from, from + 999)
    if (error) {
      throw new Error(`lyusa_submissions read: ${error.message}` +
        (error.code === 'PGRST205' ? ' -- apply supabase/migrations/0065_lyusa_submissions.sql first' : ''))
    }
    for (const r of data) sent.add(normSku(r.sku))
    if (data.length < 1000) break
  }
  return sent
}

async function fetchPhoto(url: string): Promise<Buffer> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      return await sharp(buf)
        .rotate()
        .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'contain', background: '#ffffff' })
        .flatten({ background: '#ffffff' })
        .toColorspace('srgb')
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer()
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

async function main() {
  const outDir = path.join(ROOT, 'data', 'lyusa', 'batches', name)
  if (fs.existsSync(outDir)) throw new Error(`${outDir} already exists. Pick another name or delete it first.`)
  if (!fs.existsSync(templatePath)) throw new Error(`Template not found: ${templatePath}`)

  const tplRows = readCsv(templatePath) as TemplateRow[]
  const header = Object.keys(tplRows[0])
  const filler = tplRows[0]
  const tplBySku = new Map(tplRows.map((r) => [normSku(r['Item#']), r]))

  const skuCodes = new Map<string, [string, string]>()
  const codesPath = path.join(ROOT, 'data', 'lyusa-sku-codes.csv')
  if (fs.existsSync(codesPath)) {
    for (const r of readCsv(codesPath)) skuCodes.set(normSku(r.SKU), [r['Dept#'], r['Class#']])
  }
  const skuFacts = new Map<string, SupplierFacts>()
  const factsPath = path.join(ROOT, 'data', 'lyusa-sku-supplier-facts.csv')
  if (fs.existsSync(factsPath)) {
    for (const r of readCsv(factsPath)) {
      skuFacts.set(normSku(r.SKU), { pieces: Number(r['Pieces per case']) || null, upc: r.UPC.trim() })
    }
  }

  const { data: cats, error } = await db.from('categories').select('id, name')
  if (error) throw new Error(`categories read: ${error.message}`)
  const catName = new Map(cats.map((c) => [c.id, c.name as string]))

  const visible = await fetchVisibleProducts()
  const sent = flag('--all') ? new Set<string>() : await fetchSentSkus()
  const products = visible.filter((p) => !sent.has(normSku(p.sku)))
  console.log(`${visible.length} visible products, ${visible.length - products.length} already sent -> ${products.length} in batch "${name}"`)
  if (!products.length) {
    console.log('Nothing new to send. No folder written.')
    return
  }

  // Photos first, so a failed download shows up in needs-attention.
  const photos = new Map<string, Buffer>()
  const photoErrors = new Map<string, string>()
  if (!flag('--no-photos')) {
    const withUrl = products.filter((p) => p.image_url)
    let next = 0
    let done = 0
    const worker = async () => {
      while (next < withUrl.length) {
        const p = withUrl[next++]
        try {
          photos.set(p.sku, await fetchPhoto(p.image_url!))
        } catch (err) {
          photoErrors.set(p.sku, err instanceof Error ? err.message : String(err))
        }
        if (++done % 100 === 0) console.log(`  photos ${done}/${withUrl.length}`)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  }

  const today = lyusaDate(new Date())
  const lines: string[][] = [header]
  const attention: string[][] = [['SKU', 'Name', 'Category', 'Issues']]
  for (const p of products) {
    const key = normSku(p.sku)
    const tpl = tplBySku.get(key)
    const category = (p.category_id && catName.get(p.category_id)) || ''
    const codes = skuCodes.get(key)
      ?? (tpl && tpl['Class#'] ? [tpl['Dept#'], tpl['Class#']] as [string, string] : CATEGORY_CODES[category])
    const row = buildRow(p, tpl, codes, today, skuFacts.get(key))
    lines.push(rowValues(header, row, filler))

    const reasons = attentionReasons(row, flag('--no-photos') || photos.has(p.sku))
    if (photoErrors.has(p.sku)) reasons.push(`photo download failed: ${photoErrors.get(p.sku)}`)
    if (reasons.length) attention.push([p.sku, p.name, category, reasons.join('; ')])
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `${name}-products.csv`), toCsv(lines), 'utf8')
  fs.writeFileSync(path.join(outDir, `${name}-needs-attention.csv`), toCsv(attention), 'utf8')

  const photoFiles = products
    .filter((p) => photos.has(p.sku))
    .map((p) => ({ name: `${p.sku}.jpg`, data: photos.get(p.sku)!, size: photos.get(p.sku)!.length }))
  const parts = splitIntoParts(photoFiles, PART_LIMIT)
  const zipNames: string[] = []
  parts.forEach((files, i) => {
    const zip = XLSX.CFB.utils.cfb_new()
    for (const f of files) XLSX.CFB.utils.cfb_add(zip, `/${f.name}`, f.data)
    const zipName = `${name}-photos-part${i + 1}.zip`
    fs.writeFileSync(path.join(outDir, zipName), XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }))
    zipNames.push(zipName)
  })

  fs.writeFileSync(path.join(outDir, 'batch.json'), JSON.stringify({
    name,
    created_at: new Date().toISOString(),
    mode: flag('--all') ? 'all visible products' : 'not yet in lyusa_submissions',
    template: path.relative(ROOT, templatePath),
    product_count: products.length,
    photo_count: photoFiles.length,
    needs_attention: attention.length - 1,
    photo_zips: zipNames,
    skus: products.map((p) => p.sku),
  }, null, 2) + '\n')

  console.log(`\nWrote ${outDir}`)
  console.log(`  ${products.length} products -> ${name}-products.csv`)
  console.log(`  ${photoFiles.length} photos in ${zipNames.length} zip part(s)`)
  console.log(`  ${attention.length - 1} need attention -> ${name}-needs-attention.csv`)
  if (photoErrors.size) console.log(`  ${photoErrors.size} photo download(s) failed (listed in needs-attention)`)
  console.log(`\nNot marked sent. After sending: npm run lyusa:mark-sent -- ${name}`)
}

// exitCode, not process.exit(): exiting while fetch's sockets are still
// closing aborts Node on Windows (libuv "UV_HANDLE_CLOSING" assertion).
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
