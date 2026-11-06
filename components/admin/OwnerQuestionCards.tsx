'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { OWNER_KINDS, offersRename } from '@/lib/owner-questions'

export interface OwnerQuestionRow {
  id: string
  sku: string
  kind: string
  question: string
  detail: string
  answer: string | null
  status: 'open' | 'answered' | 'done'
  answered_by: string | null
  answered_at: string | null
  product: { id: string; name: string; manually_hidden: boolean | null; price_cents: number | null; stock_qty: number | null } | null
  thumb: string | null
}

function Card({ row }: { row: OwnerQuestionRow }) {
  const router = useRouter()
  const [answer, setAnswer] = useState(row.answer ?? '')
  const [name, setName] = useState(row.product?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch('/admin/api/owner-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, ...body }),
      })
      const err = await readApiError(res, 'Could not save.')
      if (err) return setError(err)
      setNote(done)
      router.refresh()
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const p = row.product
  return (
    <div className="flex gap-4 rounded-xl border border-gray-200 bg-white p-4 text-sm">
      {row.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.thumb} alt="" className="h-24 w-24 shrink-0 rounded-lg bg-gray-100 object-contain" />
      ) : (
        <div className="h-24 w-24 shrink-0 rounded-lg bg-gray-100" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-gray-500">
          {row.sku} · {row.kind}
        </p>
        <p className="font-semibold text-gray-900">{p?.name ?? '(not in the catalog)'}</p>
        {p && (
          <p className="text-xs text-gray-500">
            {p.price_cents ? `$${(p.price_cents / 100).toFixed(2)}` : '$0'} · stock {p.stock_qty ?? 0} ·{' '}
            {p.manually_hidden ? 'hidden' : 'on the website'}
          </p>
        )}
        <p className="mt-1.5 text-gray-700">{row.detail}</p>
        <p className="mt-1 font-semibold text-gray-900">{row.question}</p>

        {row.status === 'done' ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Done</span>
            {row.answer && <span className="text-gray-700">{row.answer}</span>}
            <button type="button" disabled={busy} onClick={() => send({ action: 'reopen' }, 'Reopened.')} className="text-xs text-red-600 hover:underline disabled:opacity-50">
              Reopen
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={2}
              placeholder="Type the answer"
              disabled={busy}
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy || !answer.trim() || answer.trim() === (row.answer ?? '')}
                onClick={() => send({ action: 'answer', answer }, 'Answer saved.')}
                className="rounded-md bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                Save answer
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => send({ action: 'done' }, 'Marked done.')}
                className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {row.kind === 'QuickBooks fix' ? 'Done in QuickBooks' : 'Mark done'}
              </button>
            </div>
            {offersRename(row.kind) && p && (
              <div className="mt-1 rounded-md border border-dashed border-gray-300 p-2">
                <p className="text-xs text-gray-500">If the answer is a new name, edit it here and send it to Name review:</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                    className="min-w-[16rem] flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  <button
                    type="button"
                    disabled={busy || !name.trim() || name.trim() === p.name}
                    onClick={() => send({ action: 'rename', name }, 'Queued in Name review.')}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Send to Name review
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {row.answered_by && row.status !== 'open' && (
          <p className="mt-1 text-xs text-gray-400">
            {row.answered_by}
            {row.answered_at ? `, ${new Date(row.answered_at).toLocaleDateString()}` : ''}
          </p>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        {note && !error && <p className="mt-1 text-xs text-green-700">{note}</p>}
      </div>
    </div>
  )
}

export default function OwnerQuestionCards({ rows }: { rows: OwnerQuestionRow[] }) {
  const [view, setView] = useState<'open' | 'answered' | 'done'>('open')
  const [kind, setKind] = useState('all')
  const counts = useMemo(() => ({
    open: rows.filter((r) => r.status === 'open').length,
    answered: rows.filter((r) => r.status === 'answered').length,
    done: rows.filter((r) => r.status === 'done').length,
  }), [rows])
  const kinds = OWNER_KINDS.filter((k) => rows.some((r) => r.status === view && r.kind === k))
  const shown = rows
    .filter((r) => r.status === view && (kind === 'all' || r.kind === kind))
    .sort((a, b) => OWNER_KINDS.indexOf(a.kind as (typeof OWNER_KINDS)[number]) - OWNER_KINDS.indexOf(b.kind as (typeof OWNER_KINDS)[number]) || a.sku.localeCompare(b.sku))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['open', 'answered', 'done'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => { setView(v); setKind('all') }}
            className={'rounded-md px-3 py-1.5 text-sm font-semibold ' + (view === v ? 'bg-red-600 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50')}
          >
            {v === 'open' ? 'To answer' : v === 'answered' ? 'Answered' : 'Done'} ({counts[v]})
          </button>
        ))}
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="ml-2 rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm text-gray-900">
          <option value="all">All kinds</option>
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      {shown.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-400">Nothing here.</div>
      ) : (
        <div className="grid gap-3">
          {shown.map((r) => <Card key={r.id} row={r} />)}
        </div>
      )}
    </div>
  )
}
