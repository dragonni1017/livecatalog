import { getAdminClient } from '@/lib/supabase'
import { RepCartProvider } from '@/lib/rep-cart-context'
import RepOrderBuilder from '@/components/rep/RepOrderBuilder'

export const dynamic = 'force-dynamic'

export default async function RepOrderPage() {
  const db = getAdminClient()
  const { data: tiers } = await db
    .from('price_tiers')
    .select('code, label, discount_percent')
    .eq('active', true)
    .order('display_order')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">New Order</h1>
        <RepCartProvider>
          <RepOrderBuilder tiers={tiers ?? []} />
        </RepCartProvider>
      </div>
    </div>
  )
}
