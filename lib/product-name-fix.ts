/**
 * Apply one agreed product-name correction to Erply, WooCommerce and Supabase.
 *
 * Shared by scripts/fix-product-names.ts and /admin/api/cleanup/name, so the
 * screen and the script cannot disagree about what is safe to write. Lifted
 * out of the script unchanged in behaviour; the reasoning for writing all
 * three systems lives at the top of that script.
 *
 * SAFETY, per system:
 *  - Every change declares the name it EXPECTS to find. If the live name
 *    differs -- someone edited it, or a previous run already applied it --
 *    that system is skipped and reported, never overwritten.
 *  - After every write the name is read back independently rather than
 *    trusting the write's own response.
 *  - When `apply` is set and a system FAILS (a thrown error or a write that
 *    did not verify), the systems after it are not written. Erply is the
 *    master and goes first: writing Woo/Supabase after Erply refused would
 *    leave the three disagreeing, and Supabase would be put back by the next
 *    sync anyway. A plain skip ("SKU not in Erply") does not stop the others,
 *    exactly as in the original script.
 *
 * Nothing here decides WHAT a name should be. Callers supply `expect` and
 * `to`; the admin screen only ever prefills `to` from auditProductName's
 * suggestion, which is cosmetic-only and never invents a pack spec.
 *
 * Imports carry a literal ".ts" because the script loads this under Node's
 * native type stripping (see tsconfig's allowImportingTsExtensions).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getErplyProductByCode, isConfigured as isErplyConfigured, saveErplyProductName } from './erply.ts'
import { getWooProductBySku, isWooConfigured, updateWooProductName } from './woo.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, 'public', any>

export type NameFixSystem = 'erply' | 'woocommerce' | 'supabase'

export interface NameChangeRow {
  system: NameFixSystem
  /** Erply productID, Woo product id, or Supabase products.id; '' when not found. */
  id: string
  /** What the system holds now ('' when the product isn't there). */
  oldName: string
  newName: string
  status: string
  /** Extra context worth showing under the row (Erply's found name, a Woo error body). */
  detail?: string
}

export interface NameChangeInput {
  sku: string
  /** Guard: the name that must currently be in place. */
  expect: string
  to: string
  /** False (dry run) reports what would happen and writes nothing. */
  apply: boolean
  db: DB
}

/** Row status used when WooCommerce has no credentials in this environment. */
export const WOO_NOT_CONFIGURED = 'SKIPPED — WooCommerce not configured here'

const NAME_DIFFERS = 'SKIPPED — name differs from expected'
const EARLIER_FAILED = 'SKIPPED — an earlier system failed'

function isFailure(row: NameChangeRow): boolean {
  return row.status.startsWith('FAILED')
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function erplyStep({ sku, expect, to, apply }: NameChangeInput): Promise<NameChangeRow> {
  const product = await getErplyProductByCode(sku)
  if (!product) {
    return { system: 'erply', id: '', oldName: '', newName: to, status: 'SKIPPED — SKU not in Erply' }
  }
  const id = String(product.productId)
  if (product.name !== expect) {
    const already = product.name === to
    return {
      system: 'erply', id, oldName: product.name, newName: to,
      status: already ? 'already correct' : NAME_DIFFERS,
      ...(already ? {} : { detail: `found: ${product.name}` }),
    }
  }
  if (!apply) return { system: 'erply', id, oldName: product.name, newName: to, status: 'would update' }

  await saveErplyProductName(product.productId, to)
  // Independent re-read rather than trusting the write's own response.
  const after = await getErplyProductByCode(sku)
  return {
    system: 'erply', id, oldName: product.name, newName: to,
    status: after?.name === to ? 'updated + verified' : `FAILED — reads "${after?.name}"`,
  }
}

async function wooStep({ sku, expect, to, apply }: NameChangeInput): Promise<NameChangeRow> {
  if (!isWooConfigured()) {
    return { system: 'woocommerce', id: '', oldName: '', newName: to, status: WOO_NOT_CONFIGURED }
  }
  const found = await getWooProductBySku(sku)
  if (!found.ok) {
    return { system: 'woocommerce', id: '', oldName: '', newName: to, status: `SKIPPED — HTTP ${found.status}` }
  }
  const product = found.product
  if (!product) {
    return { system: 'woocommerce', id: '', oldName: '', newName: to, status: 'SKIPPED — SKU not in WooCommerce' }
  }
  const id = String(product.id)
  if (product.name !== expect) {
    return {
      system: 'woocommerce', id, oldName: product.name, newName: to,
      status: product.name === to ? 'already correct' : NAME_DIFFERS,
    }
  }
  if (!apply) return { system: 'woocommerce', id, oldName: product.name, newName: to, status: 'would update' }

  const put = await updateWooProductName(product.id, to)
  if (!put.ok) {
    return {
      system: 'woocommerce', id, oldName: product.name, newName: to,
      status: `FAILED — HTTP ${put.status}`, detail: put.body.slice(0, 200),
    }
  }
  return {
    system: 'woocommerce', id, oldName: product.name, newName: to,
    status: put.name === to ? 'updated + verified' : 'FAILED — name did not stick',
  }
}

async function supabaseStep({ sku, expect, to, apply, db }: NameChangeInput): Promise<NameChangeRow> {
  const { data: row, error: readError } = await db.from('products').select('id, name').eq('sku', sku).maybeSingle()
  if (readError) throw new Error(readError.message)
  if (!row) {
    return { system: 'supabase', id: '', oldName: '', newName: to, status: 'SKIPPED — SKU not in catalog' }
  }
  if (row.name !== expect) {
    return {
      system: 'supabase', id: row.id, oldName: row.name, newName: to,
      status: row.name === to ? 'already correct' : NAME_DIFFERS,
    }
  }
  if (!apply) return { system: 'supabase', id: row.id, oldName: row.name, newName: to, status: 'would update' }

  // Guarded on the expected name as well as the SKU, so an edit that lands
  // between the read above and this write is not clobbered.
  const { error } = await db
    .from('products')
    .update({ name: to, updated_at: new Date().toISOString() })
    .eq('sku', sku)
    .eq('name', expect)
  const { data: after } = await db.from('products').select('name').eq('sku', sku).single()
  return {
    system: 'supabase', id: row.id, oldName: row.name, newName: to,
    status: !error && after?.name === to ? 'updated + verified' : `FAILED — ${error?.message ?? after?.name}`,
  }
}

/**
 * Runs the three systems in order (Erply, WooCommerce, Supabase) and returns
 * one row per system. Throws only when Erply isn't configured -- the stub
 * session key in lib/erply.ts would otherwise turn every lookup into a
 * convincing-looking "SKU not in Erply".
 */
export async function applyNameChange(input: NameChangeInput): Promise<NameChangeRow[]> {
  if (!isErplyConfigured()) {
    throw new Error('Erply is not configured in this environment, so names cannot be checked or changed here.')
  }
  if (!input.sku.trim() || !input.expect || !input.to.trim()) {
    throw new Error('sku, expect and to are all required.')
  }
  if (input.to === input.expect) {
    throw new Error('The new name is the same as the current one.')
  }

  const steps: Array<[NameFixSystem, (i: NameChangeInput) => Promise<NameChangeRow>]> = [
    ['erply', erplyStep],
    ['woocommerce', wooStep],
    ['supabase', supabaseStep],
  ]

  const rows: NameChangeRow[] = []
  let halted = false
  for (const [system, step] of steps) {
    if (halted) {
      rows.push({ system, id: '', oldName: '', newName: input.to, status: EARLIER_FAILED })
      continue
    }
    let row: NameChangeRow
    try {
      row = await step(input)
    } catch (err) {
      row = { system, id: '', oldName: '', newName: input.to, status: `FAILED — ${errorMessage(err)}` }
    }
    rows.push(row)
    if (input.apply && isFailure(row)) halted = true
  }
  return rows
}
