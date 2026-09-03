import { getAdminClient } from '@/lib/supabase'
import CustomerTable from './CustomerTable'

export const dynamic = 'force-dynamic'

export interface Customer {
  id: string
  email: string
  name: string | null
  company: string | null
  discount_percent: number
  price_tier_code: string | null
  notes: string | null
  created_at: string
  updated_at: string
  order_count: number
}

export interface TierOption {
  code: string
  label: string
}

export default async function CustomersPage() {
  let customers: Customer[] = []
  let tiers: TierOption[] = []
  try {
    const db = getAdminClient()
    const [{ data: rows }, { data: orderRows }, { data: tierRows }] = await Promise.all([
      db.from('customers').select('*').order('company').order('name'),
      db.from('order_requests').select('customer_email'),
      db.from('price_tiers').select('code, label').eq('active', true).order('display_order'),
    ])

    const countByEmail: Record<string, number> = {}
    for (const o of orderRows ?? []) {
      const key = (o.customer_email ?? '').toLowerCase()
      if (key) countByEmail[key] = (countByEmail[key] ?? 0) + 1
    }

    customers = (rows ?? []).map((c) => ({
      ...(c as Omit<Customer, 'order_count'>),
      order_count: countByEmail[c.email?.toLowerCase() ?? ''] ?? 0,
    }))
    tiers = tierRows ?? []
  } catch {
    customers = []
  }

  return <CustomerTable initialCustomers={customers} tiers={tiers} />
}
