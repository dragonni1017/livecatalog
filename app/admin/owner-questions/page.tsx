import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { resolveCdnImage } from '@/lib/image'
import OwnerQuestionCards, { type OwnerQuestionRow } from '@/components/admin/OwnerQuestionCards'

export const dynamic = 'force-dynamic'

// Owner questions (migration 0073): the handoff spreadsheet's QuickBooks
// fixes, pack questions and photo-proofread flags, answered on screen.
export default async function OwnerQuestionsPage() {
  const db = getAdminClient()
  const { data, error } = await db
    .from('owner_questions')
    .select('id, sku, kind, question, detail, answer, status, answered_by, answered_at, product:products!owner_questions_product_id_fkey(id, name, image_url, manually_hidden, price_cents, stock_qty)')
    .order('created_at', { ascending: true })
    .order('sku', { ascending: true })
  const rows = ((data ?? []) as unknown as (Omit<OwnerQuestionRow, 'thumb'> & { product: { image_url: string | null } | null })[]).map(
    (r) => ({ ...r, thumb: resolveCdnImage(r.product?.image_url ?? null, 160) }),
  ) as OwnerQuestionRow[]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Dashboard</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Owner questions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Questions only the owner can answer: QuickBooks fixes, pack layouts, and names or photos that don&apos;t match the
          product. Type the answer and save. When the answer is a new product name, &quot;Send to Name review&quot; queues the
          rename there (nothing is renamed until it&apos;s approved). Case-count questions are on{' '}
          <Link href="/admin/case-count-review" className="text-red-600 hover:underline">Case-count review</Link>.
        </p>
        {error ? (
          <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn&apos;t load the questions. If migration 0073 hasn&apos;t been applied yet, apply it first.
          </p>
        ) : (
          <div className="mt-6">
            <OwnerQuestionCards rows={rows} />
          </div>
        )}
      </div>
    </div>
  )
}
