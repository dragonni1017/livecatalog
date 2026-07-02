import { getAdminClient } from '@/lib/supabase'
import CustomerTable from './CustomerTable'

export const dynamic = 'force-dynamic'

export interface Customer {
  id: string
  email: string
  name: string | null
  company: string | null
  discount_percent: number
  notes: string | null
  created_at: string
  updated_at: string
  order_count: number
}

export default async function CustomersPage() {
  let customers: Customer[] = []
  try {
    const db = getAdminClient()
    const [{ data: rows }, { data: orderRows }] = await Promise.all([
      db.from('customers').select('*').order('company').order('name'),
      db.from('order_requests').select('customer_email'),
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
  } catch {
    customers = []
  }

  return <CustomerTable initialCustomers={customers} />
}
