// fix-k229480-barcode.mjs
// Run with: node scripts/fix-k229480-barcode.mjs            (dry run)
//           node scripts/fix-k229480-barcode.mjs --apply
//
// One-row data fix found while dry-running the 2026-09-17 containers through
// receiving (docs/memory/project-containers-20260917.md): K229480's stored
// barcode is 73787910121 -- 11 digits, one short of a UPC-A. Container
// EMCU8323054's arrival list ships it as 737879101216, whose check digit
// validates and whose neighbour K229479 is the adjacent 737879101209. The
// stored value lost its trailing check digit.
//
// Writes BOTH systems. products.barcode is overwritten from Erply's code2 on
// every daily sync (app/api/sync/route.ts), so a Supabase-only fix silently
// reverts within a day.

import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') })

const APPLY = process.argv.includes('--apply')
const SKU = 'K229480'
const CORRECT = '737879101216'
const TRUNCATED = '73787910121'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// UPC-A check digit, so the replacement is verified arithmetically rather
// than trusted because a spreadsheet said so.
function upcCheckDigit(first11) {
  let sum = 0
  for (let i = 0; i < 11; i++) sum += Number(first11[i]) * (i % 2 === 0 ? 3 : 1)
  return String((10 - (sum % 10)) % 10)
}

const API_URL = `https://${process.env.ERPLY_CLIENT_CODE}.erply.com/api/`
async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: process.env.ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return res.json()
}

const valid = upcCheckDigit(TRUNCATED) === CORRECT[11] && CORRECT.startsWith(TRUNCATED)
console.log(`check digit: ${TRUNCATED} + ${upcCheckDigit(TRUNCATED)} => ${CORRECT} ${valid ? 'VALID' : 'INVALID'}`)
if (!valid) {
  console.error('Refusing to write a barcode whose check digit does not validate.')
  process.exit(1)
}

// Would the corrected value collide? This business has real barcode-collision
// history (docs/memory/project-duplicate-barcode-families.md), so never write
// a barcode onto a SKU without looking.
const { data: collisions } = await db.from('products').select('sku, name').eq('barcode', CORRECT).neq('sku', SKU)
console.log(`collisions on ${CORRECT}: ${collisions?.length ?? 0}`, JSON.stringify(collisions ?? []))
if (collisions?.length) {
  console.error('Refusing to write: another SKU already carries this barcode.')
  process.exit(1)
}

const { data: before } = await db.from('products').select('sku, name, barcode').eq('sku', SKU).single()
console.log('supabase before:', JSON.stringify(before))

const auth = await erplyPost({ request: 'verifyUser', username: process.env.ERPLY_USERNAME, password: process.env.ERPLY_PASSWORD })
const sessionKey = auth?.records?.[0]?.sessionKey
if (!sessionKey) {
  console.error('Erply auth failed:', JSON.stringify(auth?.status ?? auth))
  process.exit(1)
}
const found = await erplyPost({ request: 'getProducts', sessionKey, code: SKU, getAllLanguages: 0 })
const erplyProduct = (found?.records ?? []).find((r) => String(r.code).toUpperCase() === SKU)
console.log('erply before:', JSON.stringify(erplyProduct && { productID: erplyProduct.productID, code: erplyProduct.code, code2: erplyProduct.code2 }))

// How widespread is this? Report-only -- fixing the rest is a separate call.
const { data: shortRows } = await db.from('products').select('sku, barcode').not('barcode', 'is', null)
const elevens = (shortRows ?? []).filter((r) => /^\d{11}$/.test(r.barcode))
console.log(`other 11-digit barcodes in catalog: ${elevens.length - (before?.barcode?.length === 11 ? 1 : 0)}`)

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to write Erply code2 then Supabase.')
  process.exit(0)
}

// Erply first: it is the source of truth the sync reads back from.
if (erplyProduct) {
  // Snapshot every field first. On 2026-08-04 a saveProduct call with the
  // wrong parameter zeroed all 2,871 selling prices
  // (docs/memory/project-retail-anchor-pricing-flip.md), so a single-field
  // write on this account gets verified field by field, not just by an 'ok'.
  const snapshot = { ...erplyProduct }

  const saved = await erplyPost({ request: 'saveProduct', sessionKey, productID: String(erplyProduct.productID), code2: CORRECT })
  console.log('erply saveProduct:', JSON.stringify(saved?.status ?? saved))
  if (saved?.status?.responseStatus !== 'ok') {
    console.error('Erply write failed — not touching Supabase, or the sync would revert it.')
    process.exit(1)
  }

  const verify = await erplyPost({ request: 'getProducts', sessionKey, code: SKU, getAllLanguages: 0 })
  const post = (verify?.records ?? []).find((r) => String(r.code).toUpperCase() === SKU)
  const drifted = Object.keys(snapshot).filter(
    (k) => k !== 'code2' && k !== 'changed' && k !== 'lastModified' && JSON.stringify(snapshot[k]) !== JSON.stringify(post?.[k]),
  )
  console.log(`fields changed besides code2: ${drifted.length}`, JSON.stringify(drifted.map((k) => [k, snapshot[k], post?.[k]])))
  if (post?.code2 !== CORRECT) {
    console.error('Erply reported ok but code2 did not take — not touching Supabase.')
    process.exit(1)
  }
  if (drifted.length) {
    console.error('Erply write had side effects on other fields — inspect before trusting this row.')
  }
} else {
  console.error(`${SKU} not found in Erply — Supabase-only fix would revert on the next sync.`)
  process.exit(1)
}

const { error } = await db.from('products').update({ barcode: CORRECT }).eq('sku', SKU)
if (error) {
  console.error('Supabase update failed:', error.message)
  process.exit(1)
}

const { data: after } = await db.from('products').select('sku, barcode').eq('sku', SKU).single()
const recheck = await erplyPost({ request: 'getProducts', sessionKey, code: SKU, getAllLanguages: 0 })
const erplyAfter = (recheck?.records ?? []).find((r) => String(r.code).toUpperCase() === SKU)
console.log('supabase after:', JSON.stringify(after))
console.log('erply after:  ', JSON.stringify(erplyAfter && { code: erplyAfter.code, code2: erplyAfter.code2 }))
