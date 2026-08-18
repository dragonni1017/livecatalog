// fix-bows-pack-spec.mjs
// Run with: node scripts/fix-bows-pack-spec.mjs [--apply]
//
// The 8 "Gift Bow" SKUs in the Bows category all carry a wrong pack spec:
// "100/pk 20bx/cs cs.20" -- Dragon confirmed the real spec is 20 pieces/pack,
// 100 packs/boxes per case, "cs.100" (not the cs.2000 the repo's usual
// perPack x packsPerCase convention would imply -- Dragon explicitly wants
// cs.100 here, not cs.2000). This only rewrites the pack-spec suffix, not
// the rest of the name.
//
// Defaults to a dry run; pass --apply to write.
//
// Requires in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials in .env.local (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const SKUS = ['F286797', 'F286801', 'F286798', 'F286796', 'F286802', 'F286800', 'F286803', 'F286799']

const OLD_SPEC = '100/pk 20bx/cs cs.20'
const NEW_SPEC = '20/pk 100bx/cs cs.100'

const OUT_DIR = path.join(ROOT, 'data', 'bows-pack-spec-fix')
const OUT_CSV = path.join(OUT_DIR, 'planned-changes.csv')

async function main() {
  const { data, error } = await supabase.from('products').select('id, sku, name').in('sku', SKUS)
  if (error) {
    console.error('Fetch failed:', error.message)
    process.exit(1)
  }

  const rows = []
  for (const sku of SKUS) {
    const product = data.find((p) => p.sku === sku)
    if (!product) {
      console.log(`  SKIP ${sku}: no matching product in Supabase`)
      continue
    }
    if (!product.name.includes(OLD_SPEC)) {
      console.log(`  SKIP ${sku}: name doesn't contain the expected old spec -- "${product.name}"`)
      continue
    }
    const newName = product.name.replace(OLD_SPEC, NEW_SPEC)
    rows.push({ id: product.id, sku, oldName: product.name, newName })
  }

  console.log(`\n${rows.length}/${SKUS.length} SKUs matched and ready to update:`)
  for (const r of rows) {
    console.log(`  ${r.sku}: "${r.oldName}" -> "${r.newName}"`)
  }

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to write these changes.')
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const csvLines = ['sku,old_name,new_name', ...rows.map((r) => `${r.sku},"${r.oldName}","${r.newName}"`)]
  fs.writeFileSync(OUT_CSV, csvLines.join('\n') + '\n')
  console.log(`\nBackup written to ${path.relative(ROOT, OUT_CSV)}`)

  let updated = 0
  for (const r of rows) {
    const { error: updateError } = await supabase.from('products').update({ name: r.newName }).eq('id', r.id)
    if (updateError) {
      console.error(`  FAILED ${r.sku}:`, updateError.message)
      continue
    }
    updated++
    console.log(`  updated ${r.sku}`)
  }
  console.log(`\nDone. ${updated}/${rows.length} products updated.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
