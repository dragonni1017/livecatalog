// download-godaddy-backfill-images.mjs
// Run with: node scripts/download-godaddy-backfill-images.mjs
//
// Downloads product images from the GoDaddy/Websites+Marketing export
// (img1.wsimg.com URLs) to backfill SKUs from the last-3-months QB report
// that had no local image. Reads data/images/godaddy-backfill-urls.csv
// (sku,image_url,match_type) and writes files into data/images/recent-3mo-images/,
// named <SKU>.<ext>. Skips a SKU if a file matching that SKU already exists
// there. Also appends successful downloads to
// data/images/recent-3mo-image-mapping.csv and removes them from
// data/images/recent-3mo-skus-missing-image.csv, so both stay accurate afterwards.
//
// This has to run on your machine, not in the sandbox this was generated
// in -- img1.wsimg.com isn't reachable from that sandbox's network
// allowlist, so the images could not be pre-fetched for you.

import fs from 'fs'
import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const URLS_CSV = path.join(ROOT, 'data', 'images', 'godaddy-backfill-urls.csv')
const IMAGES_DIR = path.join(ROOT, 'data', 'images', 'recent-3mo-images')
const MAPPING_CSV = path.join(ROOT, 'data', 'images', 'recent-3mo-image-mapping.csv')
const MISSING_CSV = path.join(ROOT, 'data', 'images', 'recent-3mo-skus-missing-image.csv')

function parseCsvLine(line) {
  // handles double-quoted fields, including ones with commas inside them
  // (our image_url values are quoted because they contain a literal comma,
  // e.g. ".../:/rs=w:600,h:600") -- a plain line.split(',') truncates those
  // mid-URL and produces "Invalid URL" download failures.
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur)
      cur = ''
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

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location, destPath).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const contentType = res.headers['content-type'] || ''
        if (!contentType.startsWith('image/')) {
          reject(new Error(`unexpected content-type: ${contentType}`))
          return
        }
        const file = fs.createWriteStream(destPath)
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}

function extFromContentTypeGuess(url) {
  const m = url.match(/\.(png|jpe?g|webp|gif)\b/i)
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Windows locks files that are open in Excel/Explorer preview, which turns
// a plain fs.writeFileSync/appendFileSync into an EBUSY crash. Retry a few
// times, and if it's still locked, warn instead of throwing so downloaded
// images aren't lost to an uncaught exception.
async function writeFileSafe(filePath, content, { append = false } = {}) {
  const attempts = 5
  for (let i = 1; i <= attempts; i++) {
    try {
      if (append) fs.appendFileSync(filePath, content)
      else fs.writeFileSync(filePath, content)
      return true
    } catch (err) {
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && i < attempts) {
        await sleep(500 * i)
        continue
      }
      console.warn(
        `\nWARNING: could not write ${filePath} (${err.code || err.message}). ` +
          `Close it if it's open in Excel/Explorer and rerun this script -- ` +
          `it's safe to rerun, already-downloaded images are skipped.`
      )
      return false
    }
  }
  return false
}

async function main() {
  if (!fs.existsSync(URLS_CSV)) {
    console.error(`Missing ${URLS_CSV}`)
    process.exit(1)
  }
  fs.mkdirSync(IMAGES_DIR, { recursive: true })

  const rows = parseCsv(fs.readFileSync(URLS_CSV, 'utf8'))
  const existingFiles = fs.readdirSync(IMAGES_DIR)
  const existingStems = new Set(
    existingFiles.map((f) => path.parse(f).name.toUpperCase())
  )

  const mappingLines = []
  const stillMissing = []
  let downloaded = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const sku = row.sku
    if (!sku) continue
    if (existingStems.has(sku.toUpperCase())) {
      skipped++
      continue
    }
    const ext = extFromContentTypeGuess(row.image_url)
    const filename = `${sku}.${ext}`
    const dest = path.join(IMAGES_DIR, filename)
    try {
      await download(row.image_url, dest)
      mappingLines.push(`${sku},${filename}`)
      downloaded++
      process.stdout.write(`OK   ${sku}\n`)
    } catch (err) {
      // clean up partial file if any
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      stillMissing.push(sku)
      failed++
      process.stdout.write(`FAIL ${sku}: ${err.message}\n`)
    }
  }

  if (mappingLines.length) {
    await writeFileSafe(MAPPING_CSV, mappingLines.join('\n') + '\n', { append: true })
  }

  if (fs.existsSync(MISSING_CSV)) {
    const missingRows = parseCsv(fs.readFileSync(MISSING_CSV, 'utf8'))
    const downloadedSkus = new Set(
      rows
        .filter((r) => !stillMissing.includes(r.sku))
        .map((r) => r.sku.toUpperCase())
    )
    const remaining = missingRows
      .map((r) => r.sku)
      .filter((s) => s && !downloadedSkus.has(s.toUpperCase()))
    await writeFileSafe(MISSING_CSV, 'sku\n' + remaining.join('\n') + '\n')
  }

  console.log(
    `\nDone. downloaded=${downloaded} skipped(already had file)=${skipped} failed=${failed}`
  )
  if (failed) {
    console.log('Failed SKUs were left out of recent-3mo-image-mapping.csv and stay listed in recent-3mo-skus-missing-image.csv.')
  }
}

main()
