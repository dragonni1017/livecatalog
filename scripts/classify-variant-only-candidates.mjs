// classify-variant-only-candidates.mjs
// Run with: node scripts/classify-variant-only-candidates.mjs
//
// The 43-row "Hidden - Variant Only" tier from missing-image-worklist.xlsx
// all matched by BASE SKU (a sibling color/size variant has an image, not
// this exact SKU) -- deliberately never auto-applied by the earlier
// coverage script. This script does the actual risk classification before
// anything gets written:
//
//   - DEAD SOURCE: candidate URL is on the disabled dohwdv0ys Cloudinary
//     account (confirmed dead this session, X-Cld-Error: "cloud_name
//     dohwdv0ys is disabled") -- unusable regardless of variant risk.
//   - COLOR MISMATCH: both this SKU's suffix and the candidate's suffix
//     are recognizable color words, and they DIFFER (e.g. this SKU is
//     "-RED", candidate image is "...-BLK"). Applying would show the
//     wrong color on a live listing -- never auto-apply these.
//   - SIZE VARIANT: both suffixes look like a size marker (cm, inch,
//     XL/L/M/S, or a bare number) -- same design, different size, the
//     same pattern already visually confirmed acceptable earlier this
//     session for the companion-plush line. Lower risk, still needs a
//     spot-check, not a blind bulk-apply.
//   - GENERIC CANDIDATE: the candidate image has NO suffix at all (e.g.
//     F102518.png for F102518-RD/AGRY/BEI/DBLU) -- could be a real
//     "default" photo, or could just be showing one specific unlabeled
//     variant. Ambiguous, needs an individual look.
//   - UNCLEAR: neither pattern matched confidently -- needs an individual
//     look.
//
// Every live (non-dead-source) candidate URL is also HTTP-checked before
// being labeled usable, not just pattern-matched.
//
// Read-only against the worklist. Writes a NEW xlsx to
// data/qbd-catalog-compare/variant-only-classified.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'missing-image-worklist.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'variant-only-classified.xlsx')

const COLOR_WORDS = new Set([
  'RED', 'BLK', 'BK', 'BLACK', 'WT', 'WHITE', 'PK', 'PINK', 'BLU', 'BLUE', 'YELLOW', 'YEL',
  'GRN', 'GREEN', 'PURPLE', 'PUR', 'ORANGE', 'ORG', 'BROWN', 'BRN', 'GOLD', 'SILVER',
  'GRY', 'GRAY', 'GREY', 'FU', 'FUCHSIA', 'VIO', 'VIOLET', 'BEI', 'BEIGE', 'MIX', 'RD',
  'BG', 'AGRY', 'DBLU', 'LP', 'IVORY',
  // found while reviewing this script's own first-pass output: "BK" (not
  // just "BLK") is a real color abbreviation in this data too (e.g.
  // F286493-BK, PF20200931-BK) -- missing it silently downgraded 2 real
  // color mismatches to "UNCLEAR" instead of correctly flagging them.
])
const SIZE_WORDS = new Set(['XL', 'L', 'M', 'S', 'XS', 'SM', 'MD', 'LG', 'SD'])

function extractSuffix(id) {
  const m = String(id || '').match(/[-_]([A-Za-z0-9]+)$/)
  return m ? m[1].toUpperCase() : null
}
function isSizeLike(suffix) {
  if (!suffix) return false
  if (SIZE_WORDS.has(suffix)) return true
  if (/^\d+(CM|MM|IN|INCH)$/i.test(suffix)) return true
  return false
}
function isColorLike(suffix) {
  return suffix ? COLOR_WORDS.has(suffix) : false
}

async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return { ok: res.ok, status: res.status, cldError: res.headers.get('x-cld-error') }
  } catch (e) {
    return { ok: false, status: 0, cldError: String(e.message || e) }
  }
}

async function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['3. Hidden Variant Only'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  const classified = []
  for (const r of rows) {
    const skuSuffix = extractSuffix(r.sku)
    // candidate_image_ref is a URL -- pull the filename (public_id) out to get its own suffix
    const fileMatch = String(r.candidate_image_ref || '').match(/\/([^/]+)\.\w+$/)
    const candidateId = fileMatch ? fileMatch[1] : ''
    const candidateSuffix = extractSuffix(candidateId)

    const isDeadSource = /dohwdv0ys/.test(r.candidate_image_ref || '')
    let category
    if (isDeadSource) {
      category = 'DEAD SOURCE'
    } else if (isColorLike(skuSuffix) && isColorLike(candidateSuffix) && skuSuffix !== candidateSuffix) {
      category = 'COLOR MISMATCH -- do not apply'
    } else if (isSizeLike(skuSuffix) && isSizeLike(candidateSuffix)) {
      category = 'SIZE VARIANT -- likely safe, spot-check'
    } else if (!candidateSuffix) {
      category = 'GENERIC CANDIDATE -- ambiguous'
    } else {
      category = 'UNCLEAR -- needs individual look'
    }

    let urlCheck = { ok: null, status: null, cldError: null }
    if (!isDeadSource && r.candidate_image_ref) {
      urlCheck = await checkUrl(r.candidate_image_ref)
    }

    classified.push({
      sku: r.sku,
      product_name: r.product_name,
      sku_suffix: skuSuffix || '',
      candidate_suffix: candidateSuffix || '',
      category,
      url_status: urlCheck.status,
      url_ok: urlCheck.ok,
      candidate_image_ref: r.candidate_image_ref,
    })
  }

  const byCategory = new Map()
  for (const r of classified) byCategory.set(r.category, (byCategory.get(r.category) || 0) + 1)
  console.log('\nClassification breakdown:')
  for (const [k, v] of [...byCategory].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)

  const badUrls = classified.filter((r) => r.category !== 'DEAD SOURCE' && r.url_ok === false)
  if (badUrls.length) {
    console.log(`\nWARNING: ${badUrls.length} candidate URL(s) failed a live HTTP check (beyond the known-dead source):`)
    badUrls.forEach((r) => console.log(`  ${r.sku}: status ${r.url_status} -- ${r.candidate_image_ref}`))
  }

  const ws = XLSX.utils.json_to_sheet(classified)
  ws['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 12 }, { wch: 16 }, { wch: 34 }, { wch: 10 }, { wch: 8 }, { wch: 70 }]
  ws['!autofilter'] = { ref: ws['!ref'] }
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'Classified')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
