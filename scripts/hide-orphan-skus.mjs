// hide-orphan-skus.mjs
//
// Sets manually_hidden = true on the products that are active in Supabase
// but don't exist in Erply under any casing (see
// scripts/investigate-mismatched-skus.mjs -- all 143 mismatches fell into
// this "orphan" bucket, none were case-mismatches or Erply-inactive).
//
// Uses `manually_hidden` (not `is_active`) deliberately: per lib/types.ts,
// is_active is owned by the Erply/Excel sync process and gets overwritten
// on every sync run. manually_hidden is the admin-controlled visibility
// flag that's independent of sync -- exactly the "take off Erply, don't
// touch sync ownership" lever the admin UI's own
// ProductVisibilityToggle/PATCH /admin/api/products route uses. Products
// stay in the DB, stay is_active=true, just stop showing on the public
// storefront (all public queries filter on manually_hidden = false).
//
// Does NOT touch Erply, is_active, price, or stock. Fully reversible by
// flipping manually_hidden back to false (via this admin UI toggle or a
// re-run of this script's logic in reverse).
//
// Dry run by default. Requires --apply to write.
//
// Run with: node hide-orphan-skus.mjs           (dry run)
//           node hide-orphan-skus.mjs --apply     (writes to Supabase)

import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..')
config({ path: path.join(REPO_ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function erplySessionKey() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  return auth.records[0].sessionKey
}

async function fetchAllProducts(sessionKey, activeFlag) {
  const pageSize = 300
  let pageNo = 1
  const all = []
  while (true) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: String(pageSize),
      pageNo: String(pageNo),
      active: String(activeFlag),
    })
    all.push(...data.records)
    const total = data.status.recordsTotal ?? all.length
    if (all.length >= total || data.records.length === 0) break
    pageNo++
  }
  return all
}

async function selectAllActiveProducts(db) {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('products')
      .select('id, sku, name, manually_hidden')
      .eq('is_active', true)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase select failed: ${error.message}`)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

async function main() {
  const apply = process.argv.includes('--apply')

  console.log('Fetching Erply products (active + inactive) to find orphan SKUs...')
  const sessionKey = await erplySessionKey()
  const [active, inactive] = await Promise.all([
    fetchAllProducts(sessionKey, 1),
    fetchAllProducts(sessionKey, 0),
  ])
  const erplySkusLower = new Set([...active, ...inactive].map((p) => p.code.toLowerCase().trim()))
  console.log(`Erply: ${active.length} active, ${inactive.length} inactive (${erplySkusLower.size} total SKUs known).`)

  console.log('Loading active Supabase products...')
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const supaActive = await selectAllActiveProducts(db)
  console.log(`Supabase: ${supaActive.length} active products.\n`)

  const orphans = supaActive.filter((r) => !erplySkusLower.has(r.sku.toLowerCase().trim()))
  const toHide = orphans.filter((r) => !r.manually_hidden)
  const alreadyHidden = orphans.filter((r) => r.manually_hidden)

  console.log(`Orphan SKUs (not in Erply under any casing): ${orphans.length}`)
  console.log(`Already manually_hidden: ${alreadyHidden.length}`)
  console.log(`Would be newly hidden: ${toHide.length}`)
  console.log('\nSample (first 15):')
  for (const r of toHide.slice(0, 15)) {
    console.log(`  ${r.sku} — ${r.name.slice(0, 55)}`)
  }

  if (!apply) {
    console.log(`\nDry run only -- zero writes made. Re-run with --apply to hide ${toHide.length} products.`)
    return
  }

  console.log(`\n--apply set. Setting manually_hidden = true on ${toHide.length} products...`)
  const now = new Date().toISOString()
  const ids = toHide.map((r) => r.id)
  const CHUNK = 200
  let ok = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { error, data } = await db
      .from('products')
      .update({ manually_hidden: true, updated_at: now })
      .in('id', chunk)
      .select('id')
    if (error) {
      console.error(`Chunk failed: ${error.message}`)
    } else {
      ok += data?.length ?? 0
    }
  }
  console.log(`\nDone. ${ok}/${toHide.length} products hidden from public view (is_active untouched, still true).`)
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
