import LineCard, { type LineCardParams } from '@/components/line-card/LineCard'

export const dynamic = 'force-dynamic'

// Printable photo line card for reps (see components/line-card/LineCard.tsx).
// middleware.ts gates /rep/* to the rep role.
export default async function RepLineCardPage({ searchParams }: { searchParams: Promise<LineCardParams> }) {
  return <LineCard params={await searchParams} basePath="/rep/line-card" backHref="/rep" backLabel="← Back to Rep Account" />
}
