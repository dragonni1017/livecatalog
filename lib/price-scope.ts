import type { getAdminClient } from '@/lib/supabase'
import { pickCustomerPricing, type CustomerPricingRow, type TierRow } from '@/lib/customer-pricing'
import { formatTierAdjustment } from '@/lib/order-rules'

// "Prices at" for printable price lists and line cards: catalog price, an
// active price tier, or a specific customer profile's own pricing. The
// discount is applied with applyTierDiscount, exactly as an order would be.
//
// URL param `price`: '' (catalog) · 'tier:<code>' · 'customer:<uuid>'

export type PriceParam = { kind: 'catalog' } | { kind: 'tier'; code: string } | { kind: 'customer'; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parsePriceParam(raw: string | undefined | null): PriceParam {
  const v = (raw ?? '').trim()
  if (v.startsWith('tier:') && /^[a-z0-9_]{1,40}$/.test(v.slice(5))) return { kind: 'tier', code: v.slice(5) }
  if (v.startsWith('customer:') && UUID.test(v.slice(9))) return { kind: 'customer', id: v.slice(9) }
  return { kind: 'catalog' }
}

export interface PriceScope {
  discountPct: number
  /** For the document header, e.g. "Wholesale tier (50% off)". Null = catalog price. */
  label: string | null
}

export interface PriceOptions {
  tiers: { value: string; label: string }[]
  customers: { value: string; label: string }[]
}

interface CustomerRow extends CustomerPricingRow {
  id: string
  email: string
  name: string | null
  company: string | null
}

function customerName(c: Pick<CustomerRow, 'company' | 'name' | 'email'>): string {
  return c.company?.trim() || c.name?.trim() || c.email
}

function describe(discountPct: number, tierLabel: string | null): string {
  const adj = formatTierAdjustment(discountPct)
  const off = adj === '—' ? 'catalog price' : adj
  return tierLabel ? `${tierLabel} tier, ${off}` : off
}

async function loadTiersAndCustomers(db: ReturnType<typeof getAdminClient>) {
  const [{ data: tiers }, { data: customers }] = await Promise.all([
    db.from('price_tiers').select('code, label, discount_percent, active').order('display_order'),
    db.from('customers').select('id, email, name, company, discount_percent, price_tier_code').order('company').order('name'),
  ])
  return { tiers: (tiers ?? []) as (TierRow & { label: string })[], customers: (customers ?? []) as CustomerRow[] }
}

/** Options for the "Prices at" select: active tiers, then customers whose pricing differs from catalog. */
export async function loadPriceOptions(db: ReturnType<typeof getAdminClient>): Promise<PriceOptions> {
  const { tiers, customers } = await loadTiersAndCustomers(db)
  const tierByCode = new Map(tiers.map((t) => [t.code, t]))
  return {
    tiers: tiers
      .filter((t) => t.active)
      .map((t) => ({ value: `tier:${t.code}`, label: `${t.label} (${formatTierAdjustment(Number(t.discount_percent))})` })),
    customers: customers
      .map((c) => {
        const p = pickCustomerPricing(c, c.price_tier_code ? tierByCode.get(c.price_tier_code) ?? null : null)
        return { c, p }
      })
      .filter(({ p }) => p.discountPct !== 0)
      .map(({ c, p }) => ({ value: `customer:${c.id}`, label: `${customerName(c)} — ${describe(p.discountPct, p.tierLabel)}` })),
  }
}

/** Resolves the `price` param to a discount and a header label. Unknown or inactive → catalog price. */
export async function resolvePriceScope(db: ReturnType<typeof getAdminClient>, raw: string | undefined): Promise<PriceScope> {
  const param = parsePriceParam(raw)
  if (param.kind === 'catalog') return { discountPct: 0, label: null }
  const { tiers, customers } = await loadTiersAndCustomers(db)
  const tierByCode = new Map(tiers.map((t) => [t.code, t]))

  if (param.kind === 'tier') {
    const t = tierByCode.get(param.code)
    if (!t?.active) return { discountPct: 0, label: null }
    const pct = Number(t.discount_percent)
    return { discountPct: pct, label: pct ? describe(pct, t.label) : null }
  }

  const c = customers.find((x) => x.id === param.id)
  if (!c) return { discountPct: 0, label: null }
  const p = pickCustomerPricing(c, c.price_tier_code ? tierByCode.get(c.price_tier_code) ?? null : null)
  return { discountPct: p.discountPct, label: `${customerName(c)} (${describe(p.discountPct, p.tierLabel)})` }
}
