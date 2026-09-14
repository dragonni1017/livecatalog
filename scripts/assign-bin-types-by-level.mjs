// assign-bin-types-by-level.mjs
// Run with: node scripts/assign-bin-types-by-level.mjs           (dry run)
//           node scripts/assign-bin-types-by-level.mjs --apply   (writes Supabase)
//
// Groups the 518 mirrored bins (migration 0046, seeded by
// seed-bins-from-erply.mjs) into bin_types by shelf level, using the layout
// analyze-warehouse-map.mjs already confirmed: standard bins are coded
// AA-RR-L (2-digit aisle, 2-digit rack, 1-digit level 1-5), and level is the
// strongest available proxy for shelf height since nothing else describes
// rack shape.
//
// Creates one bin_type per level actually present ("Level 1 (floor)",
// "Level 2", ...) with NO dimensions -- this script only records which bins
// share a shape, not how big that shape is. Capacity stays unknown until a
// human measures each level and fills in length_in/width_in/height_in/
// max_weight_lb via /admin/bins. Do not guess those numbers here.
//
// Deliberately skips, and does not touch:
//   - bins already assigned a type (idempotent re-run)
//   - the 57 non-grid codes (receiving_area, shipping_area, and the
//     four-digit combined-aisle floor codes like 0102-01-1) -- these are
//     physically different fixtures (cross-aisle floor positions, not a
//     single-aisle rack shelf) and lumping them into "Level 1" would be a
//     guess about their shape, not a read of the code.

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

const GRID_CODE = /^(\d{2})-(\d{2})-(\d)$/

async function fetchBins() {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('bins')
      .select('id, code, status, bin_type_id')
      .order('code', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    all.push(...data)
    if (data.length < 1000) break
  }
  return all
}

async function ensureTypeForLevel(level, cache) {
  if (cache.has(level)) return cache.get(level)
  const name = level === 1 ? 'Level 1 (floor)' : `Level ${level}`

  const { data: existing, error: existingError } = await supabase
    .from('bin_types')
    .select('id')
    .eq('name', name)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    cache.set(level, existing.id)
    return existing.id
  }

  if (!APPLY) {
    cache.set(level, `(dry-run:${name})`)
    return cache.get(level)
  }

  const { data: created, error: createError } = await supabase
    .from('bin_types')
    .insert({ name })
    .select('id')
    .single()
  if (createError) throw createError
  cache.set(level, created.id)
  return created.id
}

async function main() {
  const bins = await fetchBins()

  const skippedNonGrid = []
  const skippedAlreadyAssigned = []
  const byLevel = new Map() // level -> bin[]

  for (const bin of bins) {
    const match = bin.code.match(GRID_CODE)
    if (!match) {
      skippedNonGrid.push(bin.code)
      continue
    }
    if (bin.bin_type_id) {
      skippedAlreadyAssigned.push(bin.code)
      continue
    }
    const level = Number(match[3])
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level).push(bin)
  }

  console.log(`${bins.length} bins total.`)
  console.log(`${skippedNonGrid.length} non-grid codes skipped (need manual review): ${skippedNonGrid.join(', ')}`)
  console.log(`${skippedAlreadyAssigned.length} already have a type -- left alone.`)
  console.log('')

  const cache = new Map()
  const levels = [...byLevel.keys()].sort((a, b) => a - b)
  for (const level of levels) {
    const group = byLevel.get(level)
    const typeId = await ensureTypeForLevel(level, cache)
    const name = level === 1 ? 'Level 1 (floor)' : `Level ${level}`
    console.log(`Level ${level}: ${group.length} bins -> "${name}" (${typeId})`)

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
  console.log('Dimensions are still unset on every type created here -- capacity stays')
  console.log('unknown until real measurements are entered via /admin/bins.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
