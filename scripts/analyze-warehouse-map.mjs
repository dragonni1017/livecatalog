// analyze-warehouse-map.mjs
// Run with: node scripts/analyze-warehouse-map.mjs
//
// Read-only. Reads `data/Warehouse Map and Barcode 06-2026.xlsx` and
// reconciles it against the bins Erply actually holds, then reports the rack
// structure -- aisles, racks per aisle, levels per rack.
//
// This is the layout knowledge that migration 0046's bin_types design needs:
// bins are grouped into a handful of physical shapes, and until now nothing
// in the repo said which bins share a shape. The map's bin codes are
// aisle-rack-level (confirmed by its own "Location Labels" sheet, which
// splits them into an aisle column and a "rack - level" column), so the level
// number is the strongest available proxy for shelf height.
//
// Sheet roles in that workbook:
//   Sheet1          - the spatial grid; cell POSITION encodes physical
//                     arrangement, read in blocks of three rows per rack
//                     (levels 3, 2, 1 top to bottom)
//   Barcode/Number  - flat lists of every label printed
//   Location Labels - the same codes split into aisle + rack-level
//
// Writes nothing. Erply is read via getBins only.

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const MAP_FILE = path.join(ROOT, 'data', 'Warehouse Map and Barcode 06-2026.xlsx')

// Codes appear as both '01-01-1' and '16 - 08 - 3' depending on the sheet, so
// whitespace around the separators is normalised away before comparing.
const CODE = /^(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})$/
function parseCode(raw) {
  const m = String(raw ?? '').trim().match(CODE)
  if (!m) return null
  const [, aisle, rack, level] = m
  return {
    code: `${aisle.padStart(2, '0')}-${rack.padStart(2, '0')}-${level}`,
    aisle: Number(aisle),
    rack: Number(rack),
    level: Number(level),
  }
}

function readMap() {
  const wb = XLSX.readFile(MAP_FILE)
  const found = new Map()
  const bySheet = {}
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null })
    let count = 0
    for (const row of rows) {
      for (const cell of row ?? []) {
        const parsed = parseCode(cell)
        if (!parsed) continue
        count++
        if (!found.has(parsed.code)) found.set(parsed.code, parsed)
      }
    }
    bySheet[name] = count
  }
  return { bins: found, bySheet }
}

async function erplyPost(params) {
  const cc = process.env.ERPLY_CLIENT_CODE
  const res = await fetch(`https://${cc}.erply.com/api/`, {
    method: 'POST',
    body: new URLSearchParams({ clientCode: cc, ...params }),
  })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}`)
  }
  return json
}

async function readErplyBins() {
  const auth = await erplyPost({
    request: 'verifyUser',
    username: process.env.ERPLY_USERNAME,
    password: process.env.ERPLY_PASSWORD,
  })
  const sessionKey = auth.records[0].sessionKey
  const all = []
  for (let pageNo = 1; ; pageNo++) {
    const d = await erplyPost({ request: 'getBins', sessionKey, recordsOnPage: '100', pageNo: String(pageNo) })
    const recs = d.records ?? []
    all.push(...recs)
    if (recs.length === 0 || all.length >= (d.status?.recordsTotal ?? 0)) break
  }
  return all
}

const { bins: mapBins, bySheet } = readMap()
console.log('=== data/Warehouse Map and Barcode 06-2026.xlsx ===')
console.log('code cells found per sheet:', JSON.stringify(bySheet))
console.log(`distinct bin codes in the map: ${mapBins.size}`)

// Rack structure. The level count per rack is what bin_types needs: racks
// with four levels have shorter shelves than racks with three.
const levelsByRack = new Map()
for (const b of mapBins.values()) {
  const key = `${String(b.aisle).padStart(2, '0')}-${String(b.rack).padStart(2, '0')}`
  if (!levelsByRack.has(key)) levelsByRack.set(key, new Set())
  levelsByRack.get(key).add(b.level)
}
const aisles = [...new Set([...mapBins.values()].map((b) => b.aisle))].sort((a, b) => a - b)
console.log(`aisles: ${aisles.length} -> ${aisles.join(', ')}`)
console.log(`racks: ${levelsByRack.size}`)

const byLevelCount = new Map()
for (const levels of levelsByRack.values()) {
  const n = levels.size
  byLevelCount.set(n, (byLevelCount.get(n) ?? 0) + 1)
}
console.log('\nracks grouped by how many levels they have:')
console.table([...byLevelCount.entries()].sort((a, b) => a[0] - b[0]).map(([levels, racks]) => ({ levels, racks })))

const levelCounts = new Map()
for (const b of mapBins.values()) levelCounts.set(b.level, (levelCounts.get(b.level) ?? 0) + 1)
console.log('bins per level (level 1 = floor):')
console.table([...levelCounts.entries()].sort((a, b) => a[0] - b[0]).map(([level, bins]) => ({ level, bins })))

console.log('\nracks per aisle:')
const racksPerAisle = new Map()
for (const key of levelsByRack.keys()) {
  const aisle = Number(key.split('-')[0])
  racksPerAisle.set(aisle, (racksPerAisle.get(aisle) ?? 0) + 1)
}
console.table(
  [...racksPerAisle.entries()].sort((a, b) => a[0] - b[0]).map(([aisle, racks]) => ({
    aisle: String(aisle).padStart(2, '0'),
    racks,
    levels: [...new Set([...mapBins.values()].filter((b) => b.aisle === aisle).map((b) => b.level))].sort().join(','),
  })),
)

// ── reconcile with Erply ────────────────────────────────────────────────────

let erplyBins
try {
  erplyBins = await readErplyBins()
} catch (e) {
  console.error(`\nErply read failed (${e.message}) -- map analysis above still stands.`)
  process.exitCode = 0
  erplyBins = null
}

if (erplyBins) {
  const erplyCodes = new Map()
  const nonGrid = []
  for (const b of erplyBins) {
    const parsed = parseCode(b.code)
    if (parsed) erplyCodes.set(parsed.code, b)
    else nonGrid.push(b.code)
  }
  console.log(`\n=== Erply: ${erplyBins.length} bins (${erplyCodes.size} grid-coded, ${nonGrid.length} other) ===`)
  if (nonGrid.length) console.log(`  non-grid codes: ${nonGrid.join(', ')}`)

  const mapOnly = [...mapBins.keys()].filter((c) => !erplyCodes.has(c)).sort()
  const erplyOnly = [...erplyCodes.keys()].filter((c) => !mapBins.has(c)).sort()
  console.table([
    { comparison: 'in both', count: [...mapBins.keys()].filter((c) => erplyCodes.has(c)).length },
    { comparison: 'printed on the map but not in Erply', count: mapOnly.length },
    { comparison: 'in Erply but not on the map', count: erplyOnly.length },
  ])
  if (mapOnly.length) console.log(`  map-only: ${mapOnly.slice(0, 40).join(', ')}${mapOnly.length > 40 ? ` … +${mapOnly.length - 40}` : ''}`)
  if (erplyOnly.length) console.log(`  Erply-only: ${erplyOnly.slice(0, 40).join(', ')}${erplyOnly.length > 40 ? ` … +${erplyOnly.length - 40}` : ''}`)
}
