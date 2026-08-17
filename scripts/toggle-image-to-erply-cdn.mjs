// toggle-image-to-erply-cdn.mjs
// Run with:
//   node scripts/toggle-image-to-erply-cdn.mjs <SKU> [<SKU2> ...]     -- swap to Erply CDN
//   node scripts/toggle-image-to-erply-cdn.mjs --revert <SKU> [...]  -- restore original
//   node scripts/toggle-image-to-erply-cdn.mjs --revert-all          -- restore every swapped SKU
//   node scripts/toggle-image-to-erply-cdn.mjs --list                -- show currently-swapped SKUs
//   node scripts/toggle-image-to-erply-cdn.mjs --sample 10           -- swap N random eligible SKUs
//
// For manually A/B-testing Erply-CDN-hosted images against the current
// Cloudinary ones in the live grid (see docs/memory -- the transparency vs
// branding investigation this session). Writes real products.image_url in
// Supabase, so it's a live change, but every swap is backed up first to
// data/images/erply-cdn-test-swap-backup.json so --revert/--revert-all can
// always put things back -- this exists specifically because a manual SQL
// swap earlier in this investigation was forgotten and left live. Safe to
// leave running for a while, but don't forget --revert-all when done.
//
// Requires data/erply-cdn-url-map.json to exist first -- run
// scripts/export-erply-cdn-url-map.mjs once (or whenever you want to pick up
// newly-added Erply CDN images) before using this.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const MAP_PATH = path.join(ROOT, 'data', 'erply-cdn-url-map.json')
const BACKUP_PATH = path.join(ROOT, 'data', 'images', 'erply-cdn-test-swap-backup.json')

function loadJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
function saveBackup(obj) {
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(obj, null, 2))
}

async function swap(skus) {
  const erplyMap = loadJson(MAP_PATH, null)
  if (!erplyMap) {
    console.error(`Missing ${MAP_PATH} -- run scripts/export-erply-cdn-url-map.mjs first.`)
    process.exit(1)
  }
  const backup = loadJson(BACKUP_PATH, {})

  for (const sku of skus) {
    const erplyUrl = erplyMap[sku]
    if (!erplyUrl) {
      console.log(`SKIP ${sku}: no Erply CDN image known (re-run export-erply-cdn-url-map.mjs if this seems wrong)`)
      continue
    }
    const { data: existing, error: readErr } = await supabase.from('products').select('image_url').eq('sku', sku).maybeSingle()
    if (readErr || !existing) {
      console.log(`SKIP ${sku}: not found in Supabase (${readErr?.message ?? 'no row'})`)
      continue
    }
    if (!(sku in backup)) {
      backup[sku] = existing.image_url // only ever record the TRUE original, never overwrite with a mid-test value
    }
    const { error: updErr } = await supabase.from('products').update({ image_url: erplyUrl }).eq('sku', sku)
    if (updErr) {
      console.log(`FAIL ${sku}: ${updErr.message}`)
      continue
    }
    console.log(`OK   ${sku} -> ${erplyUrl}`)
  }
  saveBackup(backup)
  console.log(`\nBackup of original image_url values: ${BACKUP_PATH}`)
  console.log('Revert with: node scripts/toggle-image-to-erply-cdn.mjs --revert-all')
}

async function revert(skus) {
  const backup = loadJson(BACKUP_PATH, {})
  const targets = skus ?? Object.keys(backup)
  if (targets.length === 0) {
    console.log('Nothing to revert.')
    return
  }
  for (const sku of targets) {
    const original = backup[sku]
    if (original === undefined) {
      console.log(`SKIP ${sku}: no backup on file (was it ever swapped by this script?)`)
      continue
    }
    const { error } = await supabase.from('products').update({ image_url: original }).eq('sku', sku)
    if (error) {
      console.log(`FAIL ${sku}: ${error.message}`)
      continue
    }
    console.log(`REVERTED ${sku} -> ${original}`)
    delete backup[sku]
  }
  saveBackup(backup)
}

function list() {
  const backup = loadJson(BACKUP_PATH, {})
  const skus = Object.keys(backup)
  if (skus.length === 0) {
    console.log('No SKUs currently swapped to Erply CDN.')
    return
  }
  console.log(`${skus.length} SKU(s) currently swapped to Erply CDN (original backed up):`)
  for (const sku of skus) console.log(`  ${sku}  (was: ${backup[sku]})`)
}

async function sample(n) {
  const erplyMap = loadJson(MAP_PATH, null)
  if (!erplyMap) {
    console.error(`Missing ${MAP_PATH} -- run scripts/export-erply-cdn-url-map.mjs first.`)
    process.exit(1)
  }
  const backup = loadJson(BACKUP_PATH, {})
  const candidates = Object.keys(erplyMap).filter((sku) => !(sku in backup))
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  const picked = candidates.slice(0, n)
  console.log(`Sampling ${picked.length} SKUs: ${picked.join(', ')}\n`)
  await swap(picked)
}

async function all() {
  const erplyMap = loadJson(MAP_PATH, null)
  if (!erplyMap) {
    console.error(`Missing ${MAP_PATH} -- run scripts/export-erply-cdn-url-map.mjs first.`)
    process.exit(1)
  }
  const skus = Object.keys(erplyMap)
  console.log(`Converting all ${skus.length} SKUs with a live Erply CDN image...\n`)
  await swap(skus)
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--revert-all') {
    await revert(null)
  } else if (args[0] === '--revert') {
    await revert(args.slice(1))
  } else if (args[0] === '--list') {
    list()
  } else if (args[0] === '--all') {
    await all()
  } else if (args[0] === '--sample') {
    const n = parseInt(args[1], 10) || 10
    await sample(n)
  } else if (args.length > 0) {
    await swap(args)
  } else {
    console.log(`Usage:
  node scripts/toggle-image-to-erply-cdn.mjs <SKU> [<SKU2> ...]
  node scripts/toggle-image-to-erply-cdn.mjs --sample <N>
  node scripts/toggle-image-to-erply-cdn.mjs --all
  node scripts/toggle-image-to-erply-cdn.mjs --revert <SKU> [...]
  node scripts/toggle-image-to-erply-cdn.mjs --revert-all
  node scripts/toggle-image-to-erply-cdn.mjs --list`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
