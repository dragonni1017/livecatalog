import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { SALES_TAX_FIELDS, type SalesTaxState } from '@/lib/sales-tax'
import SalesTaxManager from './SalesTaxManager'

export const dynamic = 'force-dynamic'

// Estimated sales tax per ship-to state (migration 0066, lib/sales-tax.ts,
// docs/SALES-TAX-PLAN.md).
export default async function AdminSalesTaxPage() {
  const { data, error } = await getAdminClient().from('sales_tax_states').select(SALES_TAX_FIELDS).order('state')

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-red-600 hover:text-red-700">← Admin</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Sales tax</h1>
        <p className="mt-1 text-sm text-gray-500">
          One estimated rate per ship-to state. Quotes show it as an estimate; QuickBooks still charges the real tax on
          the invoice, and no tax amount is sent to it. A state that isn&apos;t listed, or is switched off, isn&apos;t
          collected. Buyers with a verified resale certificate for the ship-to state are exempt.
        </p>
      </div>
      {error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Couldn&apos;t load rates. If this is a new install, run <code className="font-mono">supabase/migrations/0066_sales_tax.sql</code>.
        </p>
      ) : (
        <SalesTaxManager initial={(data ?? []) as SalesTaxState[]} />
      )}
    </div>
  )
}
