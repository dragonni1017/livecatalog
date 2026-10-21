'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import type { SheetRow } from '@/lib/packing-list'
import {
  bestLinesFromSheets,
  pickRecentContainers,
  type ContainerReport,
  type ContainerSkus,
  type Received,
} from '@/lib/container-check'

// "Which recent containers never came through here, and which of their SKUs
// don't exist yet?" The supplier files are in OneDrive, so the folder is
// picked and parsed in this browser; only container refs and SKUs go to the
// server. Read-only: stages nothing. See lib/container-check.ts.

const RECEIVED: Record<Received, { label: string; cls: string }> = {
  applied: { label: 'received', cls: 'bg-green-100 text-green-700' },
  staged: { label: 'staged', cls: 'bg-blue-100 text-blue-700' },
  abandoned: { label: 'abandoned', cls: 'bg-gray-100 text-gray-600' },
  'not staged': { label: 'not staged', cls: 'bg-amber-100 text-amber-800' },
}

type Report = ContainerReport & { erplyNote: string | null }

export default function ContainerCheckPanel() {
  const [count, setCount] = useState(21)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [copied, setCopied] = useState(false)

  async function check(fileList: FileList | null) {
    setError(null)
    setReport(null)
    setCopied(false)
    const files = new Map([...(fileList ?? [])].map((f) => [f.name, f]))
    const picked = pickRecentContainers([...files.keys()], count)
    if (!picked.length) {
      setError('No container files found. Pick the "import documents" folder: it needs files named like "2026-09 ETD 0914 … Arrival List … Cntr#XXXX1234567".')
      return
    }
    try {
      const containers: ContainerSkus[] = []
      for (const [i, c] of picked.entries()) {
        setBusy(`Reading container ${i + 1} of ${picked.length} (${c.ref})…`)
        let entry: ContainerSkus = { ref: c.ref, etd: c.etd, file: null, error: 'no Arrival or Original List', skus: [] }
        for (const name of c.files) {
          const wb = XLSX.read(new Uint8Array(await files.get(name)!.arrayBuffer()), { type: 'array' })
          const sheets = wb.SheetNames.map((s) => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, defval: null }) as SheetRow[])
          const { lines, error: parseError } = bestLinesFromSheets(sheets)
          entry = lines
            ? { ref: c.ref, etd: c.etd, file: name, error: null, skus: lines.map((l) => ({ sku: l.sku, pieces: l.qtyShipped })) }
            : { ref: c.ref, etd: c.etd, file: name, error: parseError, skus: [] }
          if (lines) break
        }
        containers.push(entry)
      }
      setBusy('Checking SKUs against the catalog and Erply…')
      let res: Response
      try {
        res = await fetch('/admin/api/shipments/check-containers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ containers }),
        })
      } catch {
        setError(TRANSPORT_ERROR)
        return
      }
      const err = await readApiError(res, 'The container check failed.')
      if (err) {
        setError(err)
        return
      }
      setReport(await res.json())
    } catch {
      setError('Could not read one of the files. Are they real .xlsx/.xls workbooks?')
    } finally {
      setBusy(null)
    }
  }

  async function copyMissing() {
    if (!report) return
    const text = ['SKU\tPieces\tContainers', ...report.missing.map((m) => `${m.sku}\t${m.pieces}\t${m.containers.join(', ')}`)].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setError('Could not copy to the clipboard.')
    }
  }

  const notStaged = report?.containers.filter((c) => c.received === 'not staged') ?? []
  const onSeveral = report?.missing.filter((m) => m.containers.length > 1).length ?? 0

  return (
    <section className="mt-10 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-gray-900">Check recent containers</h2>
      <p className="mt-0.5 text-sm text-gray-500">
        Finds containers that were never staged here, and SKUs on them that aren&apos;t in the catalog yet. Pick the
        OneDrive <span className="font-medium">import documents</span> folder; the files are read in this browser and
        nothing is staged or changed.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-gray-700">
          Newest
          <input
            type="number"
            min={1}
            max={60}
            value={count}
            onChange={(e) => setCount(Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
            className="w-16 rounded border border-gray-300 px-2 py-1 tabular-nums"
          />
          containers
        </label>
        <label className={`cursor-pointer rounded-lg bg-gray-900 px-3 py-1.5 font-medium text-white hover:bg-gray-700 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          Choose folder…
          <input
            type="file"
            multiple
            className="hidden"
            // Folder picking isn't in React's input typings.
            {...{ webkitdirectory: '' }}
            onChange={(e) => {
              void check(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        {busy && <span className="text-gray-500">{busy}</span>}
      </div>

      {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {report && (
        <div className="mt-4 space-y-3 text-sm">
          <p className="text-gray-700" data-container-check={notStaged.length}>
            <span className="font-medium">{notStaged.length}</span> of {report.containers.length} containers never staged.{' '}
            {report.totals.distinct.toLocaleString()} SKUs: {report.totals.live} live, {report.totals.hidden} hidden,{' '}
            <span className="font-medium">{report.totals.missing} not in the catalog</span>.
          </p>
          {report.totals.inErplyNotCatalog > 0 && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
              {report.totals.inErplyNotCatalog} SKU{report.totals.inErplyNotCatalog === 1 ? ' is' : 's are'} in Erply but not
              the catalog. That isn&apos;t a receiving backlog: the nightly sync is failing to add them. Check{' '}
              <a href="/admin/sync" className="underline">Sync</a>.
            </p>
          )}
          {report.erplyNote && <p className="text-amber-800">{report.erplyNote}</p>}

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Container</th>
                  <th className="px-3 py-2">ETD</th>
                  <th className="px-3 py-2">Here</th>
                  <th className="px-3 py-2 text-right">SKUs</th>
                  <th className="px-3 py-2 text-right">Live</th>
                  <th className="px-3 py-2 text-right">Hidden</th>
                  <th className="px-3 py-2 text-right">Not in catalog</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.containers.map((c) => (
                  <tr key={c.ref} className="align-top">
                    <td className="px-3 py-2 font-mono" title={c.file ?? undefined}>{c.ref}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500">{c.etd}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RECEIVED[c.received].cls}`}>{RECEIVED[c.received].label}</span>
                      {c.error && <p className="mt-1 max-w-xs text-xs text-red-700">Couldn&apos;t read: {c.error}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.skus}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.live}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.hidden}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${c.missing ? 'font-semibold text-amber-800' : ''}`}>
                      {c.missing}
                      {c.inErplyNotCatalog > 0 && <span className="block text-xs font-normal text-red-700">{c.inErplyNotCatalog} in Erply</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.missing.length > 0 && (
            <details className="rounded-lg border border-gray-200 px-3 py-2">
              <summary className="cursor-pointer text-gray-700">
                {report.missing.length} SKUs not in the catalog
                {onSeveral > 0 && <> ({onSeveral} ship on more than one container; create those first)</>}
              </summary>
              <button type="button" onClick={() => void copyMissing()} className="mt-2 text-xs text-red-700 underline">
                {copied ? 'Copied' : 'Copy list (pastes into Excel)'}
              </button>
              <ul className="mt-2 max-h-80 space-y-0.5 overflow-y-auto text-xs">
                {report.missing.map((m) => (
                  <li key={m.sku} className={`tabular-nums ${m.containers.length > 1 ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
                    <span className="font-mono">{m.sku}</span>: {m.pieces.toLocaleString()} pcs on {m.containers.join(', ')}
                    {m.inErply && <span className="text-red-700"> (in Erply)</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {notStaged.length > 0 && (
            <p className="text-xs text-gray-500">
              To receive a container that isn&apos;t staged, upload its Arrival List above. A SKU staged before its product
              exists can still be created from the shipment&apos;s new-products step.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
