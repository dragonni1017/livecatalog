// fix-product-names.ts
// Run with: node scripts/fix-product-names.ts                     (dry run)
//           node scripts/fix-product-names.ts --apply
//           node scripts/fix-product-names.ts --only=T641077
//
// Applies agreed product-name corrections to Erply, WooCommerce and Supabase.
// DRY RUN BY DEFAULT; --apply is required to write anything.
//
// Generalised from scripts/fix-bows-pack-spec-erply-woo.mjs, which did the
// same job for 8 Gift Bows. Same three targets and the same reason for each:
//
//  - ERPLY is the master. products.name is overwritten from it on every sync
//    (lib/product-sync.ts), so a Supabase-only rename is undone within a day.
//    saveProduct DOES accept `name` (unlike `price`, which it silently
//    discards on this account -- see docs/RECEIVING-PHASE-1-SCOPE.md).
//  - WOOCOMMERCE is written directly rather than relying on Erply's
//    WooCommerce Integration product sync, which has been unreliable and
//    manual-trigger-only in past sessions.
//  - SUPABASE is written too, so the catalog shows the corrected name
//    immediately instead of waiting for the 08:00 UTC sync. The next sync
//    writes the same value, so this is not a fight.
//
// SAFETY: every change declares the name it expects to find. If the live name
// differs -- because someone edited it, or a previous run already applied it --
// that system is SKIPPED and reported, never overwritten. So the script is
// safe to re-run, and can't clobber an edit made by hand in the meantime.
//
// Each correction must be justified in CHANGES below. Nothing is inferred:
// the naming audit deliberately proposes no fix for an inconsistent spec
// (scripts/audit-product-names.ts, docs/PRODUCT-NAMING-STANDARD.md), so every
// entry here is a human decision with its reasoning attached.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

interface Change {
  sku: string
  /** Guard: the name that must currently be in place. */
  expect: string
  to: string
  why: string
}

const CHANGES: Change[] = [
  {
    sku: 'T641077',
    expect: 'Medium Sound Tube - 12/pk 48bx/cs cs.24bx',
    to: 'Medium Sound Tube - 12/pk 48bx/cs cs.48bx',
    // The only one of the 19 inconsistent names that settles itself: it
    // states its own unit ("bx"), so cs.N must equal the box count, which the
    // same name gives as 48. No convention question and no outside evidence
    // needed. Dragon approved 2026-09-17.
    why: 'states bx, so cs.N must equal bx (48); cs.24 contradicted the name itself',
  },

  // The remaining 18, all confirmed PACK-SOLD by Dragon 2026-09-17 (the
  // ribbons, Ribbon 2.5cm, the fans/leis/headband group, and the crochet
  // flower). Pack-sold means cs.N counts packs per case, and the name already
  // states that as bx -- so cs.N takes the bx value, written with its unit,
  // which is the form 87 other catalog names use and stops the ambiguity
  // recurring.
  //
  // ASSUMPTION, recorded because the name cannot prove it: bx is taken as
  // correct and cs.N as the typo. The reverse (bx <- cs.N) would mean cases of
  // 300 packs of 20 or 288 packs of 12 -- implausibly large, and unsupported
  // by the supplier documents.
  {
    sku: 'F284020',
    expect: "Solid Purple Flower Lei - 12/pk 25bx/cs cs.288",
    to: "Solid Purple Flower Lei - 12/pk 25bx/cs cs.25pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 25bx',
  },
  {
    sku: 'F284020-LP',
    expect: "Solid Light Purple Flower Leis - 12/pk 25bx/cs cs.288",
    to: "Solid Light Purple Flower Leis - 12/pk 25bx/cs cs.25pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 25bx',
  },
  {
    sku: 'F287101',
    expect: "White Small Ribbon 1.5\" - 15/pk 3bx/cs cs.36",
    to: "White Small Ribbon 1.5\" - 15/pk 3bx/cs cs.3pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 3bx',
  },
  {
    sku: 'F287102',
    expect: "Brown Small Ribbon 1.5\" - 15/pk 3bx/cs cs.36",
    to: "Brown Small Ribbon 1.5\" - 15/pk 3bx/cs cs.3pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 3bx',
  },
  {
    sku: 'F287103',
    expect: "Pink Small Ribbon 1.5\" - 15/pk 3bx/cs cs.36",
    to: "Pink Small Ribbon 1.5\" - 15/pk 3bx/cs cs.3pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 3bx',
  },
  {
    sku: 'F287104',
    expect: "Blue Small Ribbon 1.5\" - 15/pk 3bx/cs cs.36",
    to: "Blue Small Ribbon 1.5\" - 15/pk 3bx/cs cs.3pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 3bx',
  },
  {
    sku: 'F287105',
    expect: "Red Small Ribbon 1.5\" - 15/pk 3bx/cs cs.36",
    to: "Red Small Ribbon 1.5\" - 15/pk 3bx/cs cs.3pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 3bx',
  },
  {
    sku: 'F287106',
    expect: "Lavender Small Ribbon 1.5\" - 15/pk 3bx/cs cs.36",
    to: "Lavender Small Ribbon 1.5\" - 15/pk 3bx/cs cs.3pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 3bx',
  },
  {
    sku: 'F287107',
    expect: "Fuchsia Small Ribbon 1.5\" - 15/pk 3bx/cs cs.36",
    to: "Fuchsia Small Ribbon 1.5\" - 15/pk 3bx/cs cs.3pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 3bx',
  },
  {
    sku: 'F287110',
    expect: "Gold Ribbon 1.5inch - 15/pk 3bx/cs cs.36",
    to: "Gold Ribbon 1.5inch - 15/pk 3bx/cs cs.3pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 3bx',
  },
  {
    sku: 'F287267',
    expect: "Strawberry Crochet Flower - 12/pk 22bx/cs cs.256",
    to: "Strawberry Crochet Flower - 12/pk 22bx/cs cs.22pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 22bx',
  },
  {
    sku: 'F287331',
    expect: "Ribbon 2.5cm - 20/pk 7bx/cs cs.300",
    to: "Ribbon 2.5cm - 20/pk 7bx/cs cs.7pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 7bx',
  },
  {
    sku: 'F287332',
    expect: "Ribbon 2.5cm - 20/pk 7bx/cs cs.300",
    to: "Ribbon 2.5cm - 20/pk 7bx/cs cs.7pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 7bx',
  },
  {
    sku: 'F287333',
    expect: "Ribbon 2.5cm - 20/pk 7bx/cs cs.300",
    to: "Ribbon 2.5cm - 20/pk 7bx/cs cs.7pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 7bx',
  },
  {
    sku: 'F287334',
    expect: "Ribbon 2.5cm - 20/pk 7bx/cs cs.300",
    to: "Ribbon 2.5cm - 20/pk 7bx/cs cs.7pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 7bx',
  },
  {
    sku: 'H424249',
    expect: "LED Bunny Moving Headband - 12/pk 25bx/cs cs.288",
    to: "LED Bunny Moving Headband - 12/pk 25bx/cs cs.25pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 25bx',
  },
  {
    sku: 'T641546',
    expect: "Clear Strawberry Print Fan 9\" - 12/pk 25bx/cs cs.288",
    to: "Clear Strawberry Print Fan 9\" - 12/pk 25bx/cs cs.25pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 25bx',
  },
  {
    sku: 'T641546-1',
    expect: "Clear Watermelon Print Fan - 12/pk 25bx/cs cs.288",
    to: "Clear Watermelon Print Fan - 12/pk 25bx/cs cs.25pk",
    why: 'pack-sold: cs.N counts packs per case, which the name states as 25bx',
  },
  // The one name of the 203 without a standard spec that can be fixed
  // mechanically: it already carries a COMPLETE spec in an older notation.
  // 12 per box x 24 boxes = 288 per case, which the name itself states, so
  // nothing is inferred -- only reformatted into the house shape.
  //
  // The trailing "25x25x25 42lbs" is dropped because no other catalog name
  // carries carton dimensions. NOTE those figures exist NOWHERE else: this
  // product's case_length_in / case_width_in / case_height_in /
  // case_weight_lb are all null. They survive in git history and in
  // data/product-name-fixes-applied.csv, but deliberately are NOT written to
  // the measurement columns, because "25x25x25" states no unit -- inches is
  // likely given "42lbs", but bin-capacity maths reads those columns and a
  // cm/inch mix-up there is silent and wrong (see migration 0045).
  {
    sku: 'P257281',
    expect: 'Kappy Fur Pen Giant 12pcs/bx 24bx/cs 288/cs 25x25x25 42lbs',
    to: 'Kappy Fur Pen Giant - 12/pk 24bx/cs cs.288',
    why: 'same spec in an older notation (12pcs/bx 24bx/cs 288/cs), reformatted; 12 x 24 = 288 confirms it',
  },

]

const APPLY = process.argv.includes('--apply')
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
const changes = ONLY ? CHANGES.filter((c) => c.sku.toUpperCase() === ONLY.toUpperCase()) : CHANGES

if (changes.length === 0) {
  console.error(ONLY ? `No change defined for ${ONLY}.` : 'No changes defined.')
  process.exit(1)
}

const CC = process.env.ERPLY_CLIENT_CODE
const ERPLY_URL = `https://${CC}.erply.com/api/`
// WOO_STORE_URL is stored without a scheme on this account, so add one —
// same normalisation as lib/woo.ts's storeUrl().
const WOO_URL = process.env.WOO_STORE_URL
  ? (/^https?:\/\//i.test(process.env.WOO_STORE_URL) ? process.env.WOO_STORE_URL : `https://${process.env.WOO_STORE_URL}`).replace(/\/+$/, '')
  : undefined
const wooConfigured = Boolean(WOO_URL && process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function erply(params: Record<string, string>): Promise<any> {
  const res = await fetch(ERPLY_URL, { method: 'POST', body: new URLSearchParams({ clientCode: CC!, ...params }) })
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode} ${json.status.errorField ?? ''}`)
  }
  return json
}

function wooAuth() {
  return `Basic ${Buffer.from(`${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`).toString('base64')}`
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const results: Array<{ sku: string; system: string; id: string; oldName: string; newName: string; status: string }> = []
const record = (sku: string, system: string, id: string, oldName: string, newName: string, status: string) => {
  results.push({ sku, system, id, oldName, newName, status })
  console.log(`    ${system.padEnd(11)} ${status.padEnd(28)} ${id ? `#${id}` : ''}`)
}

console.log(`${APPLY ? 'APPLYING' : '[DRY RUN]'} ${changes.length} name change(s)\n`)
if (!process.env.ERPLY_CLIENT_CODE) {
  console.error('ERPLY_CLIENT_CODE is not set; nothing can be written.')
  process.exit(1)
}
if (!wooConfigured) console.log('WooCommerce is not configured here — that system will be skipped.\n')

const auth = await erply({
  request: 'verifyUser',
  username: process.env.ERPLY_USERNAME!,
  password: process.env.ERPLY_PASSWORD!,
})
const sessionKey = auth.records[0].sessionKey

for (const change of changes) {
  console.log(`  ${change.sku}`)
  console.log(`    from: ${change.expect}`)
  console.log(`    to:   ${change.to}`)
  console.log(`    why:  ${change.why}`)

  // ── Erply ──
  const found = await erply({ request: 'getProducts', sessionKey, code: change.sku })
  const product = found.records?.[0]
  if (!product) {
    record(change.sku, 'erply', '', '', change.to, 'SKIPPED — SKU not in Erply')
  } else if (product.name !== change.expect) {
    record(change.sku, 'erply', String(product.productID), product.name, change.to,
      product.name === change.to ? 'already correct' : 'SKIPPED — name differs from expected')
    if (product.name !== change.to) console.log(`                found: ${product.name}`)
  } else if (!APPLY) {
    record(change.sku, 'erply', String(product.productID), product.name, change.to, 'would update')
  } else {
    await erply({ request: 'saveProduct', sessionKey, productID: String(product.productID), name: change.to })
    // Independent re-read rather than trusting the write's own response.
    const after = (await erply({ request: 'getProducts', sessionKey, code: change.sku })).records?.[0]
    record(change.sku, 'erply', String(product.productID), product.name, change.to,
      after?.name === change.to ? 'updated + verified' : `FAILED — reads "${after?.name}"`)
  }

  // ── WooCommerce ──
  if (wooConfigured) {
    const res = await fetch(`${WOO_URL}/wp-json/wc/v3/products?sku=${encodeURIComponent(change.sku)}&status=any`, {
      headers: { Authorization: wooAuth() },
    })
    if (!res.ok) {
      record(change.sku, 'woocommerce', '', '', change.to, `SKIPPED — HTTP ${res.status}`)
    } else {
      const wooProduct = (await res.json())[0]
      if (!wooProduct) {
        record(change.sku, 'woocommerce', '', '', change.to, 'SKIPPED — SKU not in WooCommerce')
      } else if (wooProduct.name !== change.expect) {
        record(change.sku, 'woocommerce', String(wooProduct.id), wooProduct.name, change.to,
          wooProduct.name === change.to ? 'already correct' : 'SKIPPED — name differs from expected')
      } else if (!APPLY) {
        record(change.sku, 'woocommerce', String(wooProduct.id), wooProduct.name, change.to, 'would update')
      } else {
        const put = await fetch(`${WOO_URL}/wp-json/wc/v3/products/${wooProduct.id}`, {
          method: 'PUT',
          headers: { Authorization: wooAuth(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: change.to }),
        })
        const body = await put.text()
        if (!put.ok) {
          record(change.sku, 'woocommerce', String(wooProduct.id), wooProduct.name, change.to, `FAILED — HTTP ${put.status}`)
          console.log(`                ${body.slice(0, 200)}`)
        } else {
          record(change.sku, 'woocommerce', String(wooProduct.id), wooProduct.name, change.to,
            JSON.parse(body).name === change.to ? 'updated + verified' : 'FAILED — name did not stick')
        }
      }
    }
  }

  // ── Supabase (so the catalog doesn't wait for the next sync) ──
  const { data: row } = await db.from('products').select('id, name').eq('sku', change.sku).maybeSingle()
  if (!row) {
    record(change.sku, 'supabase', '', '', change.to, 'SKIPPED — SKU not in catalog')
  } else if (row.name !== change.expect) {
    record(change.sku, 'supabase', row.id, row.name, change.to,
      row.name === change.to ? 'already correct' : 'SKIPPED — name differs from expected')
  } else if (!APPLY) {
    record(change.sku, 'supabase', row.id, row.name, change.to, 'would update')
  } else {
    const { error } = await db.from('products').update({ name: change.to }).eq('sku', change.sku)
    const { data: after } = await db.from('products').select('name').eq('sku', change.sku).single()
    record(change.sku, 'supabase', row.id, row.name, change.to,
      !error && after?.name === change.to ? 'updated + verified' : `FAILED — ${error?.message ?? after?.name}`)
  }

  console.log('')
}

const dest = path.join(ROOT, 'data', `product-name-fixes-${APPLY ? 'applied' : 'dryrun'}.csv`)
fs.mkdirSync(path.dirname(dest), { recursive: true })
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
fs.writeFileSync(
  dest,
  ['sku,system,id,old_name,new_name,status', ...results.map((r) => [r.sku, r.system, r.id, esc(r.oldName), esc(r.newName), r.status].join(','))].join('\n') + '\n',
)
console.log(`Log written to ${dest}`)
if (!APPLY) console.log('\nNothing was changed. Re-run with --apply to write.')
