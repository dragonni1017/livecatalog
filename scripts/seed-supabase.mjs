// seed-supabase.mjs
// Run with: node scripts/seed-supabase.mjs
// Seeds Supabase with all categories and products from lib/products-data.json

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') })

const __dirname = dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars. Make sure .env.local is set up.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const dataPath = resolve(__dirname, '..', 'lib', 'products-data.json')
const { categories, products } = JSON.parse(readFileSync(dataPath, 'utf8'))

async function seed() {
  console.log(`Seeding ${categories.length} categories...`)

  // Upsert categories in batches of 100
  for (let i = 0; i < categories.length; i += 100) {
    const batch = categories.slice(i, i + 100)
    const { error } = await supabase
      .from('categories')
      .upsert(batch, { onConflict: 'id' })
    if (error) { console.error('Category error:', error.message); process.exit(1) }
    console.log(`  Categories ${i + 1}–${Math.min(i + 100, categories.length)} done`)
  }

  // Deduplicate by SKU — keep last occurrence
  const skuMap = new Map()
  for (const p of products) skuMap.set(p.sku, p)
  const uniqueProducts = [...skuMap.values()]
  console.log(`\nSeeding ${uniqueProducts.length} products (${products.length - uniqueProducts.length} duplicates removed)...`)

  // Upsert products in batches of 200
  for (let i = 0; i < uniqueProducts.length; i += 200) {
    const batch = uniqueProducts.slice(i, i + 200).map(p => ({
      ...p,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase
      .from('products')
      .upsert(batch, { onConflict: 'sku' })
    if (error) { console.error('Product error:', error.message); process.exit(1) }
    console.log(`  Products ${i + 1}–${Math.min(i + 200, uniqueProducts.length)} done`)
  }

  console.log(`\n✅ Supabase seeded successfully!`)
  console.log(`   ${categories.length} categories`)
  console.log(`   ${products.length} products`)
}

seed().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
