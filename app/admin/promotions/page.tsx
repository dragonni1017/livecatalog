import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { PROMOTION_FIELDS, promotionStatus, type Promotion } from '@/lib/promotions'
import { todayPacific } from '@/lib/collections'
import PromotionsManager from './PromotionsManager'

export const dynamic = 'force-dynamic'

// Promo codes (migration 0064, lib/promotions.ts).
export default async function AdminPromotionsPage() {
  const db = getAdminClient()
  const [{ data, error }, { data: cols }, { data: cats }, { data: used }] = await Promise.all([
    db.from('promotions').select(PROMOTION_FIELDS).order('created_at', { ascending: false }),
    db.from('collections').select('id, name').order('name'),
    db.from('categories').select('id, name').order('name'),
    db.from('order_requests').select('promo_code, promo_discount_cents').not('promo_code', 'is', null),
  ])
  const savedByCode = new Map<string, number>()
  for (const o of (used ?? []) as { promo_code: string; promo_discount_cents: number | null }[]) {
    savedByCode.set(o.promo_code, (savedByCode.get(o.promo_code) ?? 0) + (o.promo_discount_cents ?? 0))
  }
  const today = todayPacific()
  const promotions = ((data ?? []) as Promotion[]).map((p) => {
    const s = promotionStatus(p, today)
    return { ...p, statusLabel: s.ok ? 'Live' : s.reason.replace(`${p.code} `, ''), live: s.ok, savedCents: savedByCode.get(p.code) ?? 0 }
  })

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-red-600 hover:text-red-700">← Admin</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Promotions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Codes buyers enter in the cart. Each line gets the better of the buyer&apos;s usual price and the code&apos;s
          price, never both, so a code never stacks on top of tier pricing. Dates are Pacific time.
        </p>
      </div>
      {error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Couldn&apos;t load promotions. If this is a new install, run <code className="font-mono">supabase/migrations/0064_promotions.sql</code>.
        </p>
      ) : (
        <PromotionsManager
          initial={promotions}
          collections={(cols ?? []) as { id: string; name: string }[]}
          categories={(cats ?? []) as { id: string; name: string }[]}
        />
      )}
    </div>
  )
}
