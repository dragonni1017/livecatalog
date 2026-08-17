// build-erply-cdn-contact-sheet.mjs
// Run with: node scripts/build-erply-cdn-contact-sheet.mjs [N] [outDir]
// (defaults: N=150, outDir=data/erply-cdn-review)
//
// Read-only QA tool. Randomly samples N SKUs that have BOTH a pre-existing
// Cloudinary image_url (from before the 2026-08-17 Erply CDN backfill --
// excludes that batch, since those are byte-identical copies by
// construction and not a meaningful comparison) AND a live Erply CDN image,
// and builds side-by-side (Cloudinary | Erply) thumbnail contact sheets,
// chunked to 50 pairs per sheet so each PNG stays a reasonable size to
// actually look at. Written for the branding/transparency spot-check in
// docs/memory/project-woo-price-integration-markup-bug.md's sibling
// investigation -- see that session's chat for the 2%-ish anomaly-rate
// finding from the first 43-SKU pass this replaces with a larger sample.
//
// Requires data/erply-cdn-url-map.json (run
// scripts/export-erply-cdn-url-map.mjs first if missing/stale) and
// data/images/erply-cdn-image-mapping.csv (written by
// scripts/download-erply-cdn-images.mjs -- used only to exclude that batch).
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Requires the `sharp` package -- not a project dependency, install with
// `npm install --no-save sharp` first if missing.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const N = parseInt(process.argv[2], 10) || 150
const OUT_DIR = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'data', 'erply-cdn-review')
const PER_SHEET = 50

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const MAP_PATH = path.join(ROOT, 'data', 'erply-cdn-url-map.json')
const BACKFILL_MAPPING_CSV = path.join(ROOT, 'data', 'images', 'erply-cdn-image-mapping.csv')
const SWAP_BACKUP_PATH = path.join(ROOT, 'data', 'images', 'erply-cdn-test-swap-backup.json')

async function main() {
  if (!fs.existsSync(MAP_PATH)) {
    console.error(`Missing ${MAP_PATH} -- run scripts/export-erply-cdn-url-map.mjs first.`)
    process.exit(1)
  }
  const erplyMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'))

  const backfilledSkus = fs.existsSync(BACKFILL_MAPPING_CSV)
    ? new Set(fs.readFileSync(BACKFILL_MAPPING_CSV, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[0]))
    : new Set()

  // Skip anything currently swapped by toggle-image-to-erply-cdn.mjs --
  // its live image_url is already an Erply URL, not a Cloudinary one to
  // compare against.
  const swappedSkus = fs.existsSync(SWAP_BACKUP_PATH)
    ? new Set(Object.keys(JSON.parse(fs.readFileSync(SWAP_BACKUP_PATH, 'utf8'))))
    : new Set()

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const products = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase.from('products').select('sku,image_url').range(from, from + PAGE - 1)
    products.push(...data)
    if (data.length < PAGE) break
  }

  const cloudinaryBySku = {}
  for (const p of products) {
    if (
      p.image_url &&
      p.image_url.includes('cloudinary') &&
      !backfilledSkus.has(p.sku) &&
      !swappedSkus.has(p.sku)
    ) {
      cloudinaryBySku[p.sku] = p.image_url
    }
  }

  const pool = Object.keys(cloudinaryBySku).filter((sku) => erplyMap[sku])
  console.log(`Candidate pool: ${pool.length} SKUs (pre-existing Cloudinary image + live Erply CDN image, excluding today's backfill batch and any currently-swapped test SKUs)`)

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const sample = pool.slice(0, Math.min(N, pool.length))
  console.log(`Sampling ${sample.length} SKUs, ${PER_SHEET} per sheet -> ${Math.ceil(sample.length / PER_SHEET)} sheet(s)`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'sample-skus.json'), JSON.stringify(sample, null, 2))

  const THUMB = 180
  const LABEL_H = 20
  const PAD = 6
  const COLS = 8
  const cellW = THUMB * 2 + PAD * 3
  const cellH = THUMB + LABEL_H + PAD * 2

  const chunks = []
  for (let i = 0; i < sample.length; i += PER_SHEET) chunks.push(sample.slice(i, i + PER_SHEET))

  let totalOk = 0
  let totalFail = 0
  const failedSkus = []

  for (let sheetIdx = 0; sheetIdx < chunks.length; sheetIdx++) {
    const chunk = chunks[sheetIdx]
    const rows = Math.ceil(chunk.length / COLS)
    const sheetW = cellW * COLS
    const sheetH = cellH * rows
    const composites = []

    for (let i = 0; i < chunk.length; i++) {
      const sku = chunk[i]
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const cellX = col * cellW
      const cellY = row * cellH
      try {
        const [cRes, eRes] = await Promise.all([fetch(cloudinaryBySku[sku]), fetch(erplyMap[sku])])
        const [cBuf, eBuf] = await Promise.all([cRes.arrayBuffer(), eRes.arrayBuffer()])
        const cThumb = await sharp(Buffer.from(cBuf))
          .resize(THUMB, THUMB, { fit: 'contain', background: { r: 230, g: 230, b: 230, alpha: 1 } })
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .png()
          .toBuffer()
        const eThumb = await sharp(Buffer.from(eBuf))
          .resize(THUMB, THUMB, { fit: 'contain', background: { r: 230, g: 230, b: 230, alpha: 1 } })
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .png()
          .toBuffer()
        const label = Buffer.from(`<svg width="${cellW}" height="${LABEL_H}"><text x="2" y="14" font-size="12" fill="black">${sku}</text></svg>`)
        composites.push({ input: cThumb, top: cellY, left: cellX + PAD })
        composites.push({ input: eThumb, top: cellY, left: cellX + PAD * 2 + THUMB })
        composites.push({ input: label, top: cellY + THUMB, left: cellX })
        totalOk++
      } catch (err) {
        console.log(`FAIL ${sku}: ${err.message}`)
        failedSkus.push(sku)
        totalFail++
      }
    }

    const outPath = path.join(OUT_DIR, `contact-sheet-${sheetIdx + 1}.png`)
    await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite(composites)
      .png()
      .toFile(outPath)
    console.log(`Wrote ${outPath} (${chunk.length} pairs, ${sheetW}x${sheetH})`)
  }

  console.log(`\nDone. ok=${totalOk} fail=${totalFail}`)
  if (failedSkus.length) console.log('Failed SKUs:', failedSkus.join(', '))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
