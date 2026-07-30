// match-deactivate-candidates.mjs
// Run with: node scripts/match-deactivate-candidates.mjs
//
// Read-only. Takes data/erply-review/deactivate-candidates.csv (from
// list-erply-deactivate-candidates.mjs) and checks each SKU against Erply's
// active product codes to split "genuinely absent from Erply" from "Erply
// carries this under a related code" -- re-deriving the 116/27-style split
// mentioned in docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md with current data.
// Writes data/erply-review/deactivate-candidates-matched.csv. Writes nothing
// to Supabase or Erply.
//
// Match categories per SKU:
//   hyphen-variant   - same code modulo a hyphen (e.g. F287279R / F287279-R)
//                       -- likely the same duplicate-listing bug class as
//                       F286606, worth a confident fix rather than a judgment call.
//   same-family      - Erply carries a different suffix of the same base code
//                       (e.g. candidate F286557-PK, Erply has F286557-BLK)
//                       -- likely a color/style variant Erply already carries
//                       under a sibling code (the flat-vs-matrix question).
//   no-match         - no related code found in Erply's active feed at all.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD

if (!ERPLY_CLIENT_CODE || !ERPLY_USERNAME || !ERPLY_PASSWORD) {
  console.error('Missing Erply credentials in .env.local.')
  process.exit(1)
}

const API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function getAllErplyActiveCodes() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  async function page(pageNo) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: '300',
      pageNo: String(pageNo),
      active: '1',
    })
    return { products: data.records, total: data.status.recordsTotal ?? 0 }
  }

  const first = await page(1)
  const all = [...first.products]
  const total = first.total
  let pageNo = 2
  while (all.length < total) {
    const { products } = await page(pageNo)
    if (products.length === 0) break
    all.push(...products)
    pageNo++
  }
  return all.map((p) => (p.code || String(p.productID)).trim())
}

function parseCsv(text) {
  const [headerLine, ...rest] = text.trim().split('\n')
  const headers = headerLine.split(',')
  return rest.map((line) => {
    // Simple CSV parse sufficient for this file's own escaping (quotes around
    // fields containing commas/quotes, doubled internal quotes).
    const fields = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') { inQuotes = false }
        else cur += ch
      } else {
        if (ch === '"') inQuotes = true
        else if (ch === ',') { fields.push(cur); cur = '' }
        else cur += ch
      }
    }
    fields.push(cur)
    const row = {}
    headers.forEach((h, i) => { row[h] = fields[i] ?? '' })
    return row
  })
}

function csvEscape(value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function baseCode(code) {
  const idx = code.lastIndexOf('-')
  return idx > 0 ? code.slice(0, idx) : code
}

function normalizeNoHyphen(code) {
  return code.replace(/-/g, '').toUpperCase()
}

async function main() {
  const inputPath = path.join(ROOT, 'data', 'erply-review', 'deactivate-candidates.csv')
  if (!fs.existsSync(inputPath)) {
    console.error(`Missing ${inputPath} -- run scripts/list-erply-deactivate-candidates.mjs first.`)
    process.exit(1)
  }
  const candidates = parseCsv(fs.readFileSync(inputPath, 'utf8'))
  console.log(`Loaded ${candidates.length} candidates from ${inputPath}`)

  console.log('Fetching active Erply codes...')
  const erplyCodes = await getAllErplyActiveCodes()
  console.log(`  ${erplyCodes.length} active Erply codes`)

  const erplyCodeSet = new Set(erplyCodes.map((c) => c.toUpperCase()))
  const erplyNoHyphenSet = new Map() // normalized-no-hyphen -> original code
  for (const c of erplyCodes) erplyNoHyphenSet.set(normalizeNoHyphen(c), c)

  const erplyByBase = new Map() // base code (upper) -> [erply codes]
  for (const c of erplyCodes) {
    const b = baseCode(c).toUpperCase()
    if (!erplyByBase.has(b)) erplyByBase.set(b, [])
    erplyByBase.get(b).push(c)
  }

  const results = candidates.map((row) => {
    const sku = row.sku
    const skuUpper = sku.toUpperCase()
    const skuBase = baseCode(sku).toUpperCase()

    const hyphenMatch = erplyNoHyphenSet.get(normalizeNoHyphen(sku))
    const familyMatches = erplyByBase.get(skuBase) ?? []

    let category
    let matchDetail = ''
    if (hyphenMatch) {
      category = 'hyphen-variant'
      matchDetail = hyphenMatch
    } else if (familyMatches.length > 0) {
      category = 'same-family'
      matchDetail = familyMatches.join('; ')
    } else {
      category = 'no-match'
    }

    return { ...row, matchCategory: category, matchDetail }
  })

  const counts = results.reduce((acc, r) => {
    acc[r.matchCategory] = (acc[r.matchCategory] ?? 0) + 1
    return acc
  }, {})

  console.log('\n=== Match summary ===')
  console.log(`hyphen-variant (likely duplicate-listing, same class as F286606): ${counts['hyphen-variant'] ?? 0}`)
  console.log(`same-family (Erply carries a sibling code, flat-vs-matrix question): ${counts['same-family'] ?? 0}`)
  console.log(`no-match (genuinely absent from Erply): ${counts['no-match'] ?? 0}`)

  const outPath = path.join(ROOT, 'data', 'erply-review', 'deactivate-candidates-matched.csv')
  const header = 'sku,name,barcode,price,category,matchCategory,matchDetail'
  const lines = results.map((r) =>
    [r.sku, r.name, r.barcode, r.price, r.category, r.matchCategory, r.matchDetail].map(csvEscape).join(','),
  )
  fs.writeFileSync(outPath, [header, ...lines].join('\n') + '\n')
  console.log(`\nWrote ${outPath}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
