// lyusa-mark-sent.ts
// Run with: npm run lyusa:mark-sent -- <name> [--sent-at YYYY-MM-DD] [--dry-run]
//
// WRITES to Supabase: records every SKU in data/lyusa/batches/<name>/ in
// lyusa_submissions (migration 0065), so the next lyusa:batch leaves them out.
// Run it only once the batch has actually gone out. Safe to re-run: rows
// already recorded for this batch are skipped.
//
// SKUs come from batch.json (written by lyusa:batch) or, for batches made
// before it existed, the Item# column of the folder's *-products.csv.
// --sent-at backdates a batch sent earlier; default is now.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { BATCH_NAME_RE, normSku } from '../lib/lyusa.ts'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const args = process.argv.slice(2)
const sentAtArg = args.includes('--sent-at') ? args[args.indexOf('--sent-at') + 1] : undefined
const dryRun = args.includes('--dry-run')
const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--sent-at')
if (!name || !BATCH_NAME_RE.test(name)) {
  console.error('Usage: npm run lyusa:mark-sent -- <batch name> [--sent-at YYYY-MM-DD] [--dry-run]')
  process.exit(1)
}
if (sentAtArg && !/^\d{4}-\d{2}-\d{2}$/.test(sentAtArg)) {
  console.error('--sent-at must be YYYY-MM-DD')
  process.exit(1)
}
const sentAt = sentAtArg ? new Date(`${sentAtArg}T12:00:00`).toISOString() : new Date().toISOString()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

function batchSkus(dir: string): string[] {
  const manifest = path.join(dir, 'batch.json')
  if (fs.existsSync(manifest)) return JSON.parse(fs.readFileSync(manifest, 'utf8')).skus
  const csvs = fs.readdirSync(dir).filter((f) => f.endsWith('-products.csv'))
  if (csvs.length !== 1) {
    throw new Error(`${dir} has no batch.json and ${csvs.length} *-products.csv files (need exactly one)`)
  }
  const wb = XLSX.readFile(path.join(dir, csvs[0]), { raw: true })
  const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: false, defval: '' })
  return rows.map((r) => r['Item#'].trim()).filter(Boolean)
}

async function main() {
  const dir = path.join(ROOT, 'data', 'lyusa', 'batches', name!)
  if (!fs.existsSync(dir)) throw new Error(`No batch folder: ${dir}`)

  const seen = new Set<string>()
  const skus = batchSkus(dir).filter((s) => !seen.has(normSku(s)) && seen.add(normSku(s)))
  if (!skus.length) throw new Error('Batch has no SKUs')

  const already = new Set<string>()
  for (let i = 0; i < skus.length; i += 200) {
    const { data, error } = await db.from('lyusa_submissions').select('sku').eq('batch', name).in('sku', skus.slice(i, i + 200))
    if (error) {
      throw new Error(`lyusa_submissions read: ${error.message}` +
        (error.code === 'PGRST205' ? ' -- apply supabase/migrations/0065_lyusa_submissions.sql first' : ''))
    }
    for (const r of data) already.add(r.sku)
  }
  const rows = skus.filter((s) => !already.has(s)).map((sku) => ({ sku, batch: name, sent_at: sentAt }))
  console.log(`Batch "${name}": ${skus.length} SKUs, ${already.size} already recorded, ${rows.length} to record (sent_at ${sentAt})`)
  if (dryRun || !rows.length) {
    if (dryRun) console.log('Dry run, nothing written.')
    return
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('lyusa_submissions').insert(rows.slice(i, i + 500))
    if (error) throw new Error(`insert failed after ${i} rows: ${error.message}`)
  }
  console.log(`Recorded ${rows.length} SKUs.`)
}

// exitCode, not process.exit(): exiting while fetch's sockets are still
// closing aborts Node on Windows (libuv "UV_HANDLE_CLOSING" assertion).
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
