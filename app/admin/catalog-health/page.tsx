import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { loadCatalogHealth, SEARCH_DAYS } from '@/lib/catalog-health-load'
import type { Check, Level } from '@/lib/catalog-health'
import PhotoCheckButton from '@/components/admin/PhotoCheckButton'

export const dynamic = 'force-dynamic'

// Catalog health: the checks that used to be run by hand (lib/catalog-health.ts),
// problems first. Read-only. A check whose query fails is listed as unavailable
// rather than failing the page.

const BADGE: Record<Level, { label: string; cls: string }> = {
  problem: { label: 'Problem', cls: 'bg-red-100 text-red-700' },
  look: { label: 'Look', cls: 'bg-amber-100 text-amber-800' },
  ok: { label: 'OK', cls: 'bg-green-100 text-green-700' },
}
const SHOW_ITEMS = 10

function CheckCard({ c }: { c: Check }) {
  const b = BADGE[c.level]
  const items = c.items ?? []
  return (
    <li className="rounded-xl border border-gray-200 bg-white px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{c.title}</h2>
          <p className="mt-1 text-sm text-gray-600">{c.summary}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${b.cls}`}>{b.label}</span>
      </div>
      {items.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {items.slice(0, SHOW_ITEMS).map((it, i) => (
            <li key={i} className="text-gray-700">
              {it.href ? <a href={it.href} target="_blank" rel="noreferrer" className="hover:text-red-600">{it.label}</a> : it.label}
              {it.detail && <span className="ml-2 text-xs text-gray-400">{it.detail}</span>}
            </li>
          ))}
          {items.length > SHOW_ITEMS && <li className="text-xs text-gray-400">…and {items.length - SHOW_ITEMS} more</li>}
        </ul>
      )}
      {c.link && (
        <Link href={c.link.href} className="mt-3 inline-block py-1 text-sm font-medium text-red-600 hover:text-red-700">
          {c.link.label} →
        </Link>
      )}
    </li>
  )
}

function TermList({ title, rows, empty }: { title: string; rows: { term: string; times: number }[]; empty: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      {rows.length ? (
        <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
          {rows.map((r) => (
            <li key={r.term}>
              <span className="font-mono">{r.term}</span>
              {r.times > 1 && <span className="ml-1.5 text-xs text-gray-400">×{r.times}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-gray-400">{empty}</p>
      )}
    </div>
  )
}

export default async function CatalogHealthPage() {
  const { checks, search, failed } = await loadCatalogHealth(getAdminClient())
  const problems = checks.filter((c) => c.level === 'problem').length
  const looks = checks.filter((c) => c.level === 'look').length

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Dashboard</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Catalog health</h1>
        <p className="mt-1 text-sm text-gray-500">
          {problems ? `${problems} problem${problems === 1 ? '' : 's'}` : 'No problems'}
          {looks ? `, ${looks} to look at` : ''}. Checked just now; reload to check again.
        </p>
        {failed.length > 0 && (
          <p className="mt-3 rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-600">
            Couldn&apos;t check: {failed.join(', ')}. See the server log.
          </p>
        )}

        <ul className="mt-6 space-y-3">
          {checks.map((c) => <CheckCard key={c.key} c={c} />)}

          <li className="rounded-xl border border-gray-200 bg-white px-5 py-4">
            <h2 className="text-base font-semibold text-gray-900">Photo files</h2>
            <p className="mt-1 mb-3 text-sm text-gray-600">
              Whether every visible product&apos;s photo actually loads, and isn&apos;t a tiny thumbnail that looks blurry on the product page.
            </p>
            <PhotoCheckButton />
          </li>
        </ul>

        {search && (
          <section className="mt-8 rounded-xl border border-gray-200 bg-white px-5 py-4">
            <h2 className="text-base font-semibold text-gray-900">What searches found nothing (last {SEARCH_DAYS} days)</h2>
            <p className="mt-1 text-sm text-gray-500">Partial words logged while typing are folded into the full search.</p>
            <div className="mt-4 grid gap-6 sm:grid-cols-3">
              <TermList title="Words" rows={search.topTerms} empty="None" />
              <TermList title="Codes not in the catalog" rows={search.missingCodes} empty="None" />
              <TermList title="Codes of hidden products" rows={search.hiddenCodes} empty="None" />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
