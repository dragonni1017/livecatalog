import LineCard, { type LineCardParams } from '@/components/line-card/LineCard'

export const dynamic = 'force-dynamic'

// Printable photo line card (see components/line-card/LineCard.tsx).
// The rep version is /rep/line-card.
export default async function AdminLineCardPage({ searchParams }: { searchParams: Promise<LineCardParams> }) {
  return <LineCard params={await searchParams} basePath="/admin/line-card" backHref="/admin" backLabel="← Back to Dashboard" />
}
