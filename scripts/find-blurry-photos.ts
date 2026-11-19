// find-blurry-photos.ts
// Run with: node scripts/find-blurry-photos.ts            (uses cached scores)
//           node scripts/find-blurry-photos.ts --refresh  (re-downloads every photo)
//
// REPORT ONLY. Reads products, downloads photos, writes to data/ and touches
// nothing else.
//
// Finds visible products whose main photo looks blurry on the product page.
// /admin/catalog-health's photo check only catches broken links and ~60px
// thumbnails by byte size; this one looks at the pixels:
//
//   - Low resolution: the product page shows the photo at 800px (1200 on
//     retina), so an original under LOW_RES_PX on its long side gets stretched
//     and goes soft. Under UNUSABLE_PX it's a smear at any size (priority 1).
//   - Soft focus (off unless SOFT_BLUR_PX is set): the photo is normalised to
//     512px and the median width of its strongest edges measured (see
//     edgeWidth). First run, 2026-11-19: nearly every photo sat at ~2px and the
//     widest full-size ones (2.3-2.6px) were fuzzy subjects and plain paper,
//     not out of focus. The only real blur was the low-res photos, at 5-6px.
//     The Laplacian `edge` score is kept in the sheet but don't cut on it: it
//     drops for any low-contrast subject (white embossed paper, pastels).
//
// The download is the size the product page asks for (w_1200, c_limit), not
// the 2-7 MB original. c_limit never upscales, so a long side under 1200 is
// the original's real size.
//
// Writes data/blurry-photos-<date>.xlsx (the to-fix list plus every score, for
// moving the cut-offs) and data/blurry-photos-<date>.html (the same list as a
// contact sheet, since =IMAGE() in the xlsx needs Excel 365). Scores are cached
// in data/blurry-photos-cache.json by URL, so a re-run after changing the
// cut-offs is instant and a re-run after replacing photos only fetches the new
// ones.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolveCdnImage } from '../lib/image.ts'
import { productUrl } from '../lib/qr.ts'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const sharp = require('sharp')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const PAGE_WIDTH = 1200 // what app/(catalog)/product/[id]/page.tsx requests
const DISPLAY_PX = 800 // ImageGallery's MAIN_WIDTH, the size it's shown at
const LOW_RES_PX = 600 // long side under this is visibly stretched on the product page
const UNUSABLE_PX = 200 // the ~60px thumbnails that got saved as the photo
const NORM_PX = 512
const CONCURRENCY = 8
const THUMB_WIDTH = 300
// Edge-width cut-off for the focus check; 0 = off. Compare against the
// percentiles and KNOWN_BLURRY printout before setting it.
const SOFT_BLUR_PX = Number(process.env.SOFT_BLUR_PX ?? 0)

// Left out of the description batches for a wrong/blurry photo
// (scripts/plan-owner-name-review.ts PHOTO_SKUS). Some are wrong rather than
// blurry, so these calibrate the cut-off; they aren't added to the list.
const KNOWN_BLURRY = new Set(['D701004', 'D701098', 'F561926', 'H424270', 'E273127', 'S162757', 'LL666', 'P257251', 'P273606-2'])

interface Score {
  w: number
  h: number
  edge: number // 95th percentile |Laplacian| over content pixels
  lapVar: number // classic Laplacian variance over the whole frame
  content: number // share of the frame that isn't flat background
  blurPx: number // median edge width at NORM_PX; higher = blurrier
  error?: string
}

const CACHE_PATH = path.join(ROOT, 'data', 'blurry-photos-cache.json')
const cache: Record<string, Score> = !process.argv.includes('--refresh') && fs.existsSync(CACHE_PATH)
  ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
  : {}

async function score(url: string): Promise<Score> {
  const r = await fetch(resolveCdnImage(url, PAGE_WIDTH)!, { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const meta = await sharp(buf).metadata()
  const { data, info } = await sharp(buf)
    .flatten({ background: '#ffffff' })
    .grayscale()
    .resize(NORM_PX, NORM_PX, { fit: 'inside', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  const px = (x: number, y: number) => data[y * W + x]
  const all: number[] = []
  const onContent: number[] = []
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = px(x, y), n = px(x, y - 1), s = px(x, y + 1), e = px(x + 1, y), w = px(x - 1, y)
      const lap = n + s + e + w - 4 * c
      all.push(lap)
      // Flat background: every neighbour within a few levels of the centre.
      const range = Math.max(c, n, s, e, w) - Math.min(c, n, s, e, w)
      if (range > 6) onContent.push(Math.abs(lap))
    }
  }
  const mean = all.reduce((a, b) => a + b, 0) / all.length
  const lapVar = all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length
  onContent.sort((a, b) => a - b)
  const edge = onContent.length ? onContent[Math.floor(onContent.length * 0.95)] : 0
  return { w: meta.width ?? 0, h: meta.height ?? 0, edge, lapVar: Math.round(lapVar), content: onContent.length / all.length, blurPx: edgeWidth(data, W, H) }
}

// Edge width in pixels at NORM_PX: across the strongest edges, the brightness
// step (range in a 7x7 window) divided by the steepest slope inside it. A
// crisp edge makes its whole step in ~1-2px; a blurred one ramps over many.
// Unlike `edge`, it doesn't drop for a low-contrast subject (white-on-white
// embossed paper, pastels), which all score low on `edge` while in focus.
function edgeWidth(data: Buffer, W: number, H: number): number {
  const grad = new Float32Array(W * H)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const gx = (data[i + 1] - data[i - 1]) / 2
      const gy = (data[i + W] - data[i - W]) / 2
      grad[i] = Math.hypot(gx, gy)
    }
  }
  const sorted = Array.from(grad).filter((g) => g > 0).sort((a, b) => a - b)
  if (sorted.length < 100) return 0
  const cut = Math.max(sorted[Math.floor(sorted.length * 0.99)], 8)
  const widths: number[] = []
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const g = grad[y * W + x]
      if (g < cut) continue
      let lo = 255, hi = 0
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const v = data[(y + dy) * W + x + dx]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      widths.push((hi - lo) / g)
    }
  }
  widths.sort((a, b) => a - b)
  return widths.length ? Number(widths[Math.floor(widths.length / 2)].toFixed(2)) : 0
}

// ---- products ----
interface Product { id: string; sku: string; name: string; image_url: string }
const products: Product[] = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('products')
    .select('id, sku, name, image_url')
    .eq('is_active', true)
    .eq('manually_hidden', false)
    .not('image_url', 'is', null)
    .order('sku')
    .range(from, from + 999)
  if (error) throw error
  products.push(...((data ?? []) as Product[]))
  if (!data || data.length < 1000) break
}
for (const p of products) p.image_url = p.image_url.trim()

const hosts = new Map<string, number>()
for (const p of products) {
  let h = 'not a URL'
  try { h = new URL(p.image_url).hostname } catch {}
  hosts.set(h, (hosts.get(h) ?? 0) + 1)
}
console.log(`${products.length} visible products with a photo:`, Object.fromEntries(hosts))

// ---- score ----
const todo = products.filter((p) => !cache[p.image_url])
console.log(`${products.length - todo.length} cached, ${todo.length} to download`)
let next = 0, done = 0
async function worker() {
  while (next < todo.length) {
    const p = todo[next++]
    try {
      cache[p.image_url] = await score(p.image_url)
    } catch (e) {
      cache[p.image_url] = { w: 0, h: 0, edge: 0, lapVar: 0, content: 0, blurPx: 0, error: e instanceof Error ? e.message : String(e) }
    }
    if (++done % 100 === 0) {
      console.log(`  ${done}/${todo.length}`)
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cache))
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
fs.writeFileSync(CACHE_PATH, JSON.stringify(cache))

// ---- classify ----
const scored = products.map((p) => ({ p, s: cache[p.image_url] }))
const ok = scored.filter((x) => !x.s.error)
const edges = ok.map((x) => x.s.blurPx).sort((a, b) => a - b)
const pct = (q: number) => edges[Math.floor(edges.length * q)]
console.log(`\nedge width (px) percentiles: p50=${pct(0.5)} p75=${pct(0.75)} p90=${pct(0.9)} p95=${pct(0.95)} p99=${pct(0.99)}`)
console.log('known-blurry photos (calibration):')
for (const x of scored.filter((x) => KNOWN_BLURRY.has(x.p.sku))) {
  console.log(`  ${x.p.sku.padEnd(10)} blurPx=${x.s.blurPx} edge=${x.s.edge} lapVar=${x.s.lapVar} ${x.s.w}x${x.s.h} content=${x.s.content.toFixed(2)}`)
}

function reasons(s: Score): string[] {
  if (s.error) return [`Photo didn't load (${s.error})`]
  const out: string[] = []
  const long = Math.max(s.w, s.h)
  if (long < UNUSABLE_PX) out.push(`Unusable: only ${s.w}x${s.h}, a smear of pixels at any size`)
  else if (long < LOW_RES_PX) out.push(`Low resolution: ${s.w}x${s.h}, stretched ${(DISPLAY_PX / long).toFixed(1)}x on the product page`)
  if (SOFT_BLUR_PX && s.blurPx > SOFT_BLUR_PX) out.push(`Out of focus: edges smeared over ${s.blurPx}px`)
  return out
}

// 1 = replace first: broken or unusable. 2 = soft on the product page.
const priority = (s: Score) => (s.error || Math.max(s.w, s.h) < UNUSABLE_PX ? 1 : 2)

const flagged = scored
  .map((x) => ({ ...x, why: reasons(x.s) }))
  .filter((x) => x.why.length)
  .sort((a, b) => priority(a.s) - priority(b.s) || Math.max(a.s.w, a.s.h) - Math.max(b.s.w, b.s.h) || a.p.sku.localeCompare(b.p.sku))
console.log(`\n${flagged.length} flagged` + (SOFT_BLUR_PX ? '' : ' (resolution + load only; set SOFT_BLUR_PX=<n> to add the focus check)'))

// ---- write ----
const date = new Date().toISOString().slice(0, 10)
const thumb = (url: string) => resolveCdnImage(url, THUMB_WIDTH)!
const fixRows = flagged.map((x, i) => ({
  '#': i + 1,
  Priority: priority(x.s),
  SKU: x.p.sku,
  Name: x.p.name,
  Problem: x.why.join('; '),
  Photo: '',
  'Size (px)': x.s.error ? '' : `${x.s.w}x${x.s.h}`,
  'Edge width (px)': x.s.blurPx,
  'Product page': productUrl(x.p.id),
  'Image URL': x.p.image_url,
  'Fixed? (Y)': '',
  Notes: '',
}))
const allRows = scored
  .sort((a, b) => b.s.blurPx - a.s.blurPx)
  .map((x) => ({ SKU: x.p.sku, Name: x.p.name, Width: x.s.w, Height: x.s.h, 'Edge width (px)': x.s.blurPx, 'Edge score': x.s.edge, 'Laplacian var': x.s.lapVar, 'Content share': Number(x.s.content.toFixed(2)), Error: x.s.error ?? '', 'Product page': productUrl(x.p.id) }))

const wb = XLSX.utils.book_new()
const fix = XLSX.utils.json_to_sheet(fixRows)
fixRows.forEach((r, i) => {
  // =IMAGE() renders the thumbnail in the cell in Excel 365 / Excel for the web.
  fix[XLSX.utils.encode_cell({ r: i + 1, c: 4 })] = { t: 'str', f: `IMAGE("${thumb(r['Image URL'])}")` }
})
fix['!cols'] = [{ wch: 4 }, { wch: 12 }, { wch: 40 }, { wch: 50 }, { wch: 20 }, { wch: 11 }, { wch: 10 }, { wch: 36 }, { wch: 40 }, { wch: 9 }, { wch: 24 }]
fix['!rows'] = [{}, ...fixRows.map(() => ({ hpt: 90 }))]
XLSX.utils.book_append_sheet(wb, fix, 'To fix')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows), 'All scores')
const xlsxPath = path.join(ROOT, 'data', `blurry-photos-${date}.xlsx`)
XLSX.writeFile(wb, xlsxPath)

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const html = `<!doctype html><meta charset="utf-8"><title>Blurry photos ${date}</title>
<style>body{font:14px system-ui;margin:20px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.c{border:1px solid #ccc;border-radius:6px;padding:8px}.c img{width:100%;height:240px;object-fit:contain;background:#f6f6f6}
.w{color:#b00;font-size:12px}a{color:#036}</style>
<h1>Blurry product photos: ${flagged.length} to fix (${date})</h1>
<p>P1 = unusable, replace first. P2 = soft when enlarged on the product page. Click the SKU to open the product page.</p>
<div class="g">${flagged.map((x, i) => `<div class="c"><img loading="lazy" src="${esc(resolveCdnImage(x.p.image_url, 600)!)}">
<div><b>${i + 1}. P${priority(x.s)} <a href="${esc(productUrl(x.p.id))}" target="_blank">${esc(x.p.sku)}</a></b> ${esc(x.p.name)}</div>
<div class="w">${esc(x.why.join('; '))}</div></div>`).join('\n')}</div>`
const htmlPath = path.join(ROOT, 'data', `blurry-photos-${date}.html`)
fs.writeFileSync(htmlPath, html)
console.log(`\nWrote ${path.relative(ROOT, xlsxPath)} and ${path.relative(ROOT, htmlPath)}`)
