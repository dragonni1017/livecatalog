'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { blockersForDelete } from '@/lib/receiving'
import NewProductsPanel from './NewProductsPanel'

// Client-side workbook read, same approach as components/admin/ExcelDropzone.tsx:
// SheetJS runs in the browser and only the raw cell grid is POSTed, so every
// rule that decides a received quantity stays server-side in lib/packing-list.ts.
//
// Every sheet is sent, not just the first: the supplier files put the line
// items on whichever tab they feel like, and the server finds the one with a
// 货号 column.

export interface ShipmentLine {
  id: string
  sku: string
  barcode_from_file: string | null
  qty_shipped: number
  qty_received: number
  match_status: 'matched' | 'unmatched_sku' | 'barcode_mismatch'
  case_length_in: number | null
  case_width_in: number | null
  case_height_in: number | null
  case_weight_lb: number | null
  erply_stock_before: number | null
  erply_stock_after: number | null
  applied_at: string | null
  apply_error: string | null
  // Phase 2 (migration 0049) — null on a shipment staged before it, and on
  // every line until a Commercial Invoice is attached.
  cartons: number | null
  pieces_per_case: number | null
  invoice_line_no: number | null
  invoice_description: string | null
  invoice_unit_price_cents: number | null
  invoice_match_basis: string | null
  proposed_name: string | null
  proposed_category: string | null
  proposed_price_cents: number | null
  proposed_pieces_per_pack: number | null
  erply_created_product_id: number | null
  created_product_at: string | null
  create_error: string | null
}

export interface Shipment {
  id: string
  file_name: string
  container_ref: string | null
  line_count: number
  status: 'staged' | 'applied' | 'abandoned'
  notes: string | null
  staged_by: string | null
  staged_at: string
  applied_by: string | null
  applied_at: string | null
}

const MATCH_LABEL: Record<string, string> = {
  matched: 'Matched',
  unmatched_sku: 'Not in catalog',
  barcode_mismatch: 'UPC mismatch',
}

const MATCH_STYLE: Record<string, string> = {
  matched: 'bg-green-100 text-green-800',
  unmatched_sku: 'bg-gray-200 text-gray-700',
  barcode_mismatch: 'bg-red-100 text-red-700',
}

export default function ReceivingUpload({ initialShipments }: { initialShipments: Shipment[] }) {
  const [shipments, setShipments] = useState(initialShipments)
  const [shipment, setShipment] = useState<Shipment | null>(null)
  const [lines, setLines] = useState<ShipmentLine[]>([])
  const [problems, setProblems] = useState<Array<{ where: string; problem: string }>>([])
  const [unitNote, setUnitNote] = useState<string | null>(null)

  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [confirmNotReceived, setConfirmNotReceived] = useState(false)
  const [containerRef, setContainerRef] = useState('')
  const [notes, setNotes] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const eligible = lines.filter((l) => l.match_status === 'matched' && l.qty_received > 0 && !l.applied_at)
  const totalPieces = eligible.reduce((sum, l) => sum + l.qty_received, 0)
  const isApplied = shipment?.status === 'applied'

  async function handleFile(file: File) {
    setError(null)
    setFlash(null)
    setParsing(true)
    try {
      if (!file.name.match(/\.(xlsx|xls)$/i)) {
        setError('Please upload an .xlsx or .xls file.')
        return
      }
      const data = new Uint8Array(await file.arrayBuffer())
      const workbook = XLSX.read(data, { type: 'array' })

      // Send every sheet's raw grid; the server picks the one with a SKU column.
      const sheets = workbook.SheetNames.map((name) => ({
        name,
        rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null }),
      }))
      // The header-row scan only looks at the first 10 rows, so a sheet with
      // no 货号 near the top is not the line-item tab.
      const candidate =
        sheets.find((s) =>
          (s.rows as unknown[][])
            .slice(0, 10)
            .some((r) => Array.isArray(r) && r.some((c) => typeof c === 'string' && c.includes('货号'))),
        ) ?? sheets[0]

      const res = await fetch('/admin/api/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: file.name,
          container_ref: containerRef.trim() || null,
          rows: candidate.rows,
        }),
      })
      const err = await readApiError(res, 'Could not read that packing list.')
      if (err) {
        setError(err)
        return
      }
      const json = await res.json()
      setShipment(json.shipment)
      setLines(json.lines ?? [])
      setProblems(json.problems ?? [])
      setUnitNote(json.unitNote ?? null)
      setNotes(json.shipment?.notes ?? '')
      setContainerRef(json.shipment?.container_ref ?? '')
      setConfirmNotReceived(false)
      if (json.alreadyStaged) {
        setFlash('This exact file was already staged — showing the existing shipment rather than staging it twice.')
      }
      setShipments((prev) => (prev.some((s) => s.id === json.shipment.id) ? prev : [json.shipment, ...prev]))
    } catch {
      setError('Could not read that file. Is it a real .xlsx/.xls workbook?')
    } finally {
      setParsing(false)
    }
  }

  // Reopens a shipment from the history table.
  //
  // Read-only: it loads the same state handleFile sets, so every downstream
  // gate is unchanged — apply still re-reads the lines server-side and still
  // refuses an already-applied shipment. `problems`/`unitNote` describe the
  // parse that staged it and aren't stored, so they reset rather than
  // carrying the previous shipment's values over.
  async function openShipment(s: Shipment) {
    if (s.id === shipment?.id || loadingId) return
    setError(null)
    setFlash(null)
    setLoadingId(s.id)
    try {
      const res = await fetch(`/admin/api/shipments/${s.id}`)
      const err = await readApiError(res, 'Could not open that shipment.')
      if (err) {
        setError(err)
        return
      }
      const json = await res.json()
      setShipment(json.shipment)
      setLines(json.lines ?? [])
      setProblems([])
      setUnitNote(null)
      setNotes(json.shipment?.notes ?? '')
      setContainerRef(json.shipment?.container_ref ?? '')
      setConfirmNotReceived(false)
      setShipments((prev) => prev.map((p) => (p.id === json.shipment.id ? json.shipment : p)))
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setLoadingId(null)
    }
  }

  // Discards a staged shipment so its file can be staged again from scratch.
  //
  // Needed because `match_status` is decided once at staging and the unique
  // file_hash makes a re-upload reopen the same rows — a shipment staged
  // before a matching rule changed is stuck wrong, and "abandon" doesn't
  // release the file either. The real guard is server-side in
  // blockersForDelete; this only decides whether to offer the button, and the
  // history rows don't carry their lines, so it sees status alone for
  // everything but the shipment currently open. Anything it lets through and
  // the server refuses comes back as the server's own reason.
  async function deleteShipment(s: Shipment) {
    const known = s.id === shipment?.id ? lines : []
    const blockers = blockersForDelete(s, known)
    if (blockers.length > 0) {
      setError(`This shipment can't be deleted: ${blockers.join('; ')}.`)
      return
    }
    if (
      !confirm(
        `Delete the staged shipment "${s.container_ref || s.file_name}"?\n\n` +
          `Its ${s.line_count} staged lines go with it. No stock has been registered and no products created, ` +
          `so nothing in Erply changes — you can upload the same file again to re-stage it.`,
      )
    )
      return

    setError(null)
    setFlash(null)
    setDeletingId(s.id)
    try {
      const res = await fetch(`/admin/api/shipments?shipment_id=${encodeURIComponent(s.id)}`, { method: 'DELETE' })
      const err = await readApiError(res, 'Could not delete that shipment.')
      if (err) {
        setError(err)
        return
      }
      setShipments((prev) => prev.filter((x) => x.id !== s.id))
      // Clear the editor too if that's the shipment it was showing, or it
      // would keep offering Apply for rows that no longer exist.
      if (shipment?.id === s.id) {
        setShipment(null)
        setLines([])
        setProblems([])
        setUnitNote(null)
        setContainerRef('')
        setNotes('')
        setConfirmNotReceived(false)
      }
      setFlash(`Deleted "${s.container_ref || s.file_name}". Upload the file again to re-stage it.`)
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setDeletingId(null)
    }
  }

  function setQty(id: string, value: string) {
    const qty = value === '' ? 0 : Number(value)
    if (!Number.isFinite(qty) || qty < 0) return
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, qty_received: Math.floor(qty) } : l)))
  }

  async function saveCounts() {
    if (!shipment) return
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/admin/api/shipments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_id: shipment.id,
          container_ref: containerRef,
          notes,
          lines: lines.map((l) => ({ id: l.id, qty_received: l.qty_received })),
        }),
      })
      const err = await readApiError(res, 'Could not save the counts.')
      if (err) {
        setError(err)
        return
      }
      const json = await res.json()
      setShipment(json.shipment)
      setLines(json.lines ?? [])
      setFlash('Counts saved.')
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setSaving(false)
    }
  }

  async function apply() {
    if (!shipment) return
    setError(null)
    setFlash(null)
    setApplying(true)
    try {
      // Save first: the apply route reads qty_received from the database, not
      // from this form, so an unsaved edit would register the wrong quantity.
      const saveRes = await fetch('/admin/api/shipments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_id: shipment.id,
          container_ref: containerRef,
          notes,
          lines: lines.map((l) => ({ id: l.id, qty_received: l.qty_received })),
        }),
      })
      const saveErr = await readApiError(saveRes, 'Could not save the counts before applying.')
      if (saveErr) {
        setError(saveErr)
        return
      }

      const res = await fetch('/admin/api/shipments/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipment.id, confirm_not_yet_received: true }),
      })
      const err = await readApiError(res, 'Could not apply the shipment.')
      if (err) {
        setError(err)
        return
      }
      const json = await res.json()
      setShipment(json.shipment)
      setLines(json.lines ?? [])
      setShipments((prev) => prev.map((s) => (s.id === json.shipment.id ? json.shipment : s)))
      const skipped = json.skippedMissingInErply?.length
        ? ` ${json.skippedMissingInErply.length} SKU(s) weren't in Erply and were skipped.`
        : ''
      setFlash(`Registered ${json.piecesRegistered} pieces across ${json.applied} SKUs.${skipped} ${json.note}`)
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div>
      {/* ── Upload ─────────────────────────────────────────────────────── */}
      {!shipment && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium text-gray-700">
            Container / reference (optional)
            <input
              value={containerRef}
              onChange={(e) => setContainerRef(e.target.value)}
              placeholder="e.g. EMCU8402359"
              className="mt-1 block w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="mt-4 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={parsing}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
              }}
              className="mx-auto block text-sm"
            />
            <p className="mt-3 text-sm text-gray-500">
              {parsing ? 'Reading…' : 'Upload the supplier “Original List” .xlsx for this container.'}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Nothing is written to stock at this stage — you review the counts first.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {flash && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{flash}</div>
      )}

      {/* ── Staged shipment ────────────────────────────────────────────── */}
      {shipment && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
            <div>
              <p className="font-semibold text-gray-900">{shipment.container_ref || shipment.file_name}</p>
              <p className="text-xs text-gray-500">
                {shipment.file_name} · {lines.length} SKUs · staged {new Date(shipment.staged_at).toLocaleString()}
                {shipment.staged_by ? ` by ${shipment.staged_by}` : ''}
              </p>
              {unitNote && <p className="mt-0.5 text-xs text-gray-400">Carton figures read as {unitNote}.</p>}
            </div>
            <div className="text-right">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  isApplied ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {isApplied ? 'Applied' : 'Staged'}
              </span>
              {isApplied && shipment.applied_at && (
                <p className="mt-1 text-xs text-gray-400">
                  {new Date(shipment.applied_at).toLocaleString()}
                  {shipment.applied_by ? ` · ${shipment.applied_by}` : ''}
                </p>
              )}
            </div>
          </div>

          {problems.length > 0 && (
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-3">
              <p className="text-sm font-medium text-amber-900">
                {problems.length} row{problems.length !== 1 ? 's' : ''} in the sheet couldn&apos;t be read
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                {problems.slice(0, 8).map((p, i) => (
                  <li key={i}>
                    {p.where}: {p.problem}
                  </li>
                ))}
                {problems.length > 8 && <li>…and {problems.length - 8} more</li>}
              </ul>
            </div>
          )}

          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">SKU</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">Match</th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700">Shipped</th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700">Received</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-700">Carton</th>
                <th className="px-4 py-2 text-right font-semibold text-gray-700">Erply stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line) => (
                <tr key={line.id} className={line.match_status !== 'matched' ? 'bg-gray-50/70' : undefined}>
                  <td className="px-4 py-2 font-medium text-gray-900">
                    {line.sku}
                    {line.barcode_from_file && (
                      <span className="ml-2 text-xs text-gray-400">UPC {line.barcode_from_file}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${MATCH_STYLE[line.match_status]}`}>
                      {MATCH_LABEL[line.match_status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">{line.qty_shipped}</td>
                  <td className="px-4 py-2 text-right">
                    {isApplied || line.match_status !== 'matched' ? (
                      <span className={line.match_status !== 'matched' ? 'text-gray-400' : 'font-medium text-gray-900'}>
                        {line.match_status !== 'matched' ? '—' : line.qty_received}
                      </span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        value={line.qty_received}
                        onChange={(e) => setQty(line.id, e.target.value)}
                        className={`w-20 rounded border px-2 py-1 text-right text-sm ${
                          line.qty_received !== line.qty_shipped ? 'border-amber-400 bg-amber-50' : 'border-gray-300'
                        }`}
                      />
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {line.case_length_in != null
                      ? `${line.case_length_in}×${line.case_width_in}×${line.case_height_in} in, ${line.case_weight_lb} lb`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-gray-500">
                    {line.applied_at
                      ? `${line.erply_stock_before ?? '?'} → ${line.erply_stock_after ?? '?'}`
                      : line.apply_error
                        ? <span className="text-red-600">failed</span>
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ── Confirm + apply ──────────────────────────────────────── */}
          <div className="border-t border-gray-200 px-5 py-4">
            {isApplied ? (
              <div>
                <p className="text-sm text-gray-700">
                  This shipment has been applied and its counts are now the record of what was registered in Erply.
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  The catalog&apos;s own stock figures update on the next Erply stock sync — they aren&apos;t written directly.
                </p>
                <button
                  onClick={() => { setShipment(null); setLines([]); setProblems([]); setFlash(null) }}
                  className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Receive another shipment
                </button>
              </div>
            ) : (
              <>
                <label className="block text-sm">
                  <span className="font-medium text-gray-700">Receiving notes (optional)</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="e.g. 2 cartons short on F287410, water damage on one pallet"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>

                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <label className="flex items-start gap-2 text-sm text-amber-900">
                    <input
                      type="checkbox"
                      checked={confirmNotReceived}
                      onChange={(e) => setConfirmNotReceived(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">This container has not already been received.</span> Applying an old
                      packing list adds stock that was received and sold long ago — an earlier test container parsed
                      perfectly and would have injected thousands of phantom pieces.
                    </span>
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    onClick={apply}
                    disabled={!confirmNotReceived || applying || saving || eligible.length === 0}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {applying ? 'Registering…' : `Apply — add ${totalPieces} pieces across ${eligible.length} SKUs`}
                  </button>
                  <button
                    onClick={saveCounts}
                    disabled={saving || applying}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save counts for later'}
                  </button>
                  <button
                    onClick={() => { setShipment(null); setLines([]); setProblems([]); setError(null); setFlash(null) }}
                    className="text-sm text-gray-500 hover:text-gray-800"
                  >
                    Close
                  </button>
                </div>

                {lines.some((l) => l.match_status !== 'matched') && (
                  <p className="mt-3 text-xs text-gray-500">
                    {lines.filter((l) => l.match_status !== 'matched').length} line(s) are excluded from apply — a SKU
                    that isn&apos;t in the catalog, or a UPC that disagrees with the one on file. Create them below
                    first; their stock can be applied on a later pass.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── New products (Phase 2) ─────────────────────────────────────── */}
      {shipment && (
        <NewProductsPanel shipmentId={shipment.id} lines={lines} onLines={setLines} />
      )}

      {/* ── History ────────────────────────────────────────────────────── */}
      {shipments.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Previous shipments</h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {shipments.map((s) => (
                  <tr key={s.id} className={s.id === shipment?.id ? 'bg-red-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-2">
                      {/* A button rather than a click on the whole row: the row
                          also carries the delete control, and this keeps the
                          open action reachable from the keyboard. */}
                      <button
                        type="button"
                        onClick={() => openShipment(s)}
                        disabled={loadingId !== null || s.id === shipment?.id}
                        className="text-left disabled:cursor-default"
                      >
                        <p className="font-medium text-gray-900 hover:text-red-700">
                          {s.container_ref || s.file_name}
                          {s.id === shipment?.id && (
                            <span className="ml-2 text-xs font-normal text-gray-500">open below</span>
                          )}
                          {loadingId === s.id && (
                            <span className="ml-2 text-xs font-normal text-gray-500">opening…</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">{s.file_name}</p>
                      </button>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{s.line_count} SKUs</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.status === 'applied'
                            ? 'bg-green-100 text-green-800'
                            : s.status === 'abandoned'
                              ? 'bg-gray-200 text-gray-600'
                              : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {new Date(s.applied_at ?? s.staged_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {(() => {
                        // Same predicate the route enforces. Applied
                        // shipments are the record of a one-way Erply add, so
                        // the control says why rather than disappearing.
                        const blockers = blockersForDelete(s, s.id === shipment?.id ? lines : [])
                        if (blockers.length > 0) {
                          return (
                            <span className="text-xs text-gray-400" title={blockers.join('; ')}>
                              kept as a receipt
                            </span>
                          )
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => deleteShipment(s)}
                            disabled={deletingId === s.id}
                            className="text-xs font-medium text-red-600 hover:text-red-800 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
                          >
                            {deletingId === s.id ? 'Deleting…' : 'Delete'}
                          </button>
                        )
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
