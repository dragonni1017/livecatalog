// assign-remaining-bin-types.mjs
// Run with: node scripts/assign-remaining-bin-types.mjs           (dry run)
//           node scripts/assign-remaining-bin-types.mjs --apply   (writes Supabase)
//
// Follow-up to assign-bin-types-by-level.mjs, which grouped the 461 standard
// AA-RR-L coded bins by shelf level and deliberately left 57 non-grid bins
// unassigned because they're physically different fixtures, not just
// another rack level. This script gives those 57 their own types instead:
//
//   - 'receiving_area', 'shipping_area'      -> one type each
//   - AAAA-RR-1 (four-digit combined-aisle,  -> one shared type,
//     floor-level, e.g. '0102-01-1')            "Combined-aisle floor"
//
// The 55 combined-aisle codes are lumped into a single type because nothing
// in the data distinguishes their shape from one another -- they're all
// level 1, all the same code pattern, just different aisle pairs. If they
// turn out to differ physically, split them by hand in /admin/bins.
//
// Like the level script, this creates types with NO dimensions -- it only
// records which bins share a shape, not how big it is. Capacity stays
// unknown until a human measures each type and fills in dimensions via
// /admin/bins.

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const COMBINED_AISLE_CODE = /^\d{4}-\d{2}-\d$/

function classify(code) {
  if (code === 'receiving_area') return 'Receiving area'
  if (code === 'shipping_area') return 'Shipping area'
  if (COMBINED_AISLE_CODE.test(code)) return 'Combined-aisle floor'
  return null
}

async function fetchBins() {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('bins')
      .select('id, code, bin_type_id')
      .order('code', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    all.push(...data)
    if (data.length < 1000) break
  }
  return all
}

async function ensureType(name, cache) {
  if (cache.has(name)) return cache.get(name)

  const { data: existing, error: existingError } = await supabase
    .from('bin_types')
    .select('id')
    .eq('name', name)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    cache.set(name, existing.id)
    return existing.id
  }

  if (!APPLY) {
    cache.set(name, `(dry-run:${name})`)
    return cache.get(name)
  }

  const { data: created, error: createError } = await supabase
    .from('bin_types')
    .insert({ name })
    .select('id')
    .single()
  if (createError) throw createError
  cache.set(name, created.id)
  return created.id
}

async function main() {
  const bins = await fetchBins()

  const stillUnclassified = []
  const alreadyAssigned = []
  const byType = new Map() // type name -> bin[]

  for (const bin of bins) {
    if (bin.bin_type_id) {
      alreadyAssigned.push(bin.code)
      continue
    }
    const typeName = classify(bin.code)
    if (!typeName) {
      stillUnclassified.push(bin.code)
      continue
    }
    if (!byType.has(typeName)) byType.set(typeName, [])
    byType.get(typeName).push(bin)
  }

  console.log(`${bins.length} bins total.`)
  console.log(`${alreadyAssigned.length} already have a type -- left alone.`)
  if (stillUnclassified.length > 0) {
    console.log(`${stillUnclassified.length} still unclassified: ${stillUnclassified.join(', ')}`)
  }
  console.log('')

  const cache = new Map()
  for (const [typeName, group] of byType) {
    const typeId = await ensureType(typeName, cache)
    console.log(`${typeName}: ${group.length} bins (${typeId})`)

    if (!APPLY) continue

    const ids = group.map((b) => b.id)
    const { error } = await supabase
      .from('bins')
      .update({ bin_type_id: typeId, updated_at: new Date().toISOString() })
      .in('id', ids)
    if (error) throw error
  }

  console.log('')
  console.log(APPLY ? 'Applied.' : 'Dry run only -- pass --apply to write.')
  console.log('Dimensions are still unset -- capacity stays unknown until real')
  console.log('measurements are entered via /admin/bins.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
