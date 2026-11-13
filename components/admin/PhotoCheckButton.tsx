'use client'

import { useState } from 'react'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'

interface BadPhoto { id: string; sku: string; name: string; verdict: 'broken' | 'tiny'; detail: string }

// Runs /admin/api/catalog-health/photos on click (about half a minute).
export default function PhotoCheckButton() {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')
  const [result, setResult] = useState<{ checked: number; bad: BadPhoto[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setState('running')
    setError(null)
    try {
      const res = await fetch('/admin/api/catalog-health/photos')
      const err = await readApiError(res, 'Photo check failed.')
      if (err) { setError(err); setState('idle'); return }
      setResult(await res.json())
      setState('done')
    } catch {
      setError(TRANSPORT_ERROR)
      setState('idle')
    }
  }

  const broken = result?.bad.filter((b) => b.verdict === 'broken') ?? []
  const tiny = result?.bad.filter((b) => b.verdict === 'tiny') ?? []

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={state === 'running'}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        {state === 'running' ? 'Checking every photo… (about 30 seconds)' : state === 'done' ? 'Check again' : 'Check photo files'}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {result && (
        <div className="mt-3 text-sm">
          <p className={result.bad.length ? 'text-amber-800' : 'text-green-700'}>
            {result.checked.toLocaleString()} photos checked.{' '}
            {result.bad.length ? `${broken.length} don't load, ${tiny.length} are thumbnail-sized (blurry on the product page).` : 'All load at a usable size.'}
          </p>
          {result.bad.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.bad.map((b) => (
                <li key={b.id} className="flex gap-2">
                  <span className={`rounded px-1.5 text-xs font-medium ${b.verdict === 'broken' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                    {b.verdict === 'broken' ? "doesn't load" : 'thumbnail'}
                  </span>
                  <a href={`/product/${b.id}`} className="text-gray-800 hover:text-red-600" target="_blank" rel="noreferrer">
                    <span className="font-mono text-xs">{b.sku}</span> {b.name}
                  </a>
                  <span className="text-xs text-gray-400">{b.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
