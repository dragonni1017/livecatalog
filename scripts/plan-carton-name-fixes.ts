// plan-carton-name-fixes.ts
// Run with: node scripts/plan-carton-name-fixes.ts [data/broken-product-names-20261006.csv]
//
// Writes data/product-name-fixes-plan-carton.csv (sku,expect,to,why) for
// scripts/fix-product-names.ts --plan=... to dry-run and apply. Writes
// nothing anywhere else.
//
// The input lists live names that are raw QuickBooks descriptions, carton
// dimensions and weight included, e.g.
//   "Glass Flower Vase - 30/cs - 23" x 14" x 15" - 30lbs - 30/pk 1bx/cs cs.30"
// They came from products created from the 2026-09-23 container before
// lib/qb-descriptor.ts existed (docs/memory/project-qb-product-create-plan-20261001.md).
//
// The fix is cosmetic only: the part before the pack spec is cleaned with the
// same descriptorFromQbDesc the receiving flow uses, and the pack spec is
// carried over CHARACTER FOR CHARACTER. Whether a spec like "60/pk 1bx/cs
// cs.60" is right is a separate, human question (the floral papers elsewhere
// are 20/pk 60bx/cs) and this plan does not touch it.
//
// A name with no pack spec keeps its QuickBooks case count ("- 60pk/cs") so
// the only pack information it has isn't lost; the carton text still goes.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'
import { parseProductName } from '../lib/product-naming.ts'
import { descriptorFromQbDesc, PACK_TOKEN_RES } from '../lib/qb-descriptor.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const input = path.resolve(ROOT, process.argv[2] ?? 'data/broken-product-names-20261006.csv')
const dest = path.join(ROOT, 'data', 'product-name-fixes-plan-carton.csv')

/**
 * Heads the cleaner can't get right, each with its reason. The pack spec is
 * still carried over from the live name.
 */
const HEAD_OVERRIDES: Record<string, { head: string; why: string }> = {
  // "7x23x17cm" is the box's own size (cm), not a carton: keep it.
  'F287279-B': { head: 'Black Heart Box w/ Gold Letters 7x23x17cm', why: 'kept the product size 7x23x17cm' },
  'F287279-Pp': { head: 'Purple Heart Box w/ Gold Letters 7x23x17cm', why: 'kept the product size 7x23x17cm' },
  'F287279-R': { head: 'Red Heart Box w/ Gold Letters 7x23x17cm', why: 'kept the product size 7x23x17cm' },
  // QuickBooks dropped one "x", so the carton regex doesn't see a carton.
  F288021: { head: 'Floral Foam Cross', why: 'carton "50" x 40" 10"" is missing an x' },
  'FD400059-25YARD': { head: 'Silver Ribbon 4CM', why: 'carton "19" x 14" 17"" is missing an x' },
}

const wb = XLSX.read(fs.readFileSync(input), { type: 'buffer', raw: true })
const rows = XLSX.utils.sheet_to_json<{ sku: string; name: string }>(wb.Sheets[wb.SheetNames[0]], { raw: false })

const plan: Array<{ sku: string; expect: string; to: string; why: string }> = []
const skipped: string[] = []
for (const { sku, name } of rows) {
  const parsed = parseProductName(name)
  // The spec exactly as written: everything after the base, minus its " - ".
  // (parseProductName's base is the trimmed text before the spec.)
  const spec = parsed.spec ? name.trimStart().slice(parsed.base.length).replace(/^\s*-\s*/, '') : null
  const override = HEAD_OVERRIDES[sku]
  const head = override?.head ?? descriptorFromQbDesc(parsed.base, sku).head
  if (!head) { skipped.push(`${sku}: nothing left after cleaning`); continue }

  let to: string
  if (spec) {
    to = `${head} - ${spec}`
  } else {
    const token = PACK_TOKEN_RES.map((re) => re.exec(name)?.[0]).find(Boolean)
    to = token ? `${head} - ${token.trim()}` : head
  }
  if (to === name) { skipped.push(`${sku}: already clean`); continue }
  plan.push({
    sku, expect: name, to,
    why: override?.why ?? (spec ? 'carton dims/weight and QB case text removed; pack spec unchanged' : 'carton dims/weight removed; no pack spec, QB case count kept'),
  })
}

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
fs.writeFileSync(dest, ['sku,expect,to,why', ...plan.map((p) => [p.sku, p.expect, p.to, p.why].map(esc).join(','))].join('\n') + '\n')
for (const p of plan) console.log(`${p.sku.padEnd(16)} ${p.to}`)
for (const s of skipped) console.log(`SKIPPED ${s}`)
console.log(`\n${plan.length} planned, ${skipped.length} skipped -> ${dest}`)
