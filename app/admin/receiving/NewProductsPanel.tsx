'use client'

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { buildProductName, parseProductName } from '@/lib/product-naming'
import type { ShipmentLine } from './ReceivingUpload'

// Phase 2: the SKUs on this shipment that aren't in the catalog yet.
//
// The packing list has no English name, category or price, so nothing here is
// automatic. The Commercial Invoice supplies English (in customs phrasing),
// the SKU suffix supplies the colour, and the shipment supplies pieces per
// case — the admin supplies the rest and approves every row before anything
// is created in Erply.

interface ProductGroup {
  id: number
  name: string
}

interface Draft {
  descriptor: string
  category: string
  priceDollars: string
  piecesPerPack: string
}

const BASIS_LABEL: Record<string, string> = {
  'cartons+pieces': 'matched on cartons + pieces',
  pieces: 'matched on pieces only',
  'family-share': 'shared with its colourway family',
}

export default function NewProductsPanel({
  shipmentId,
  lines,
  onLines,
}: {
  shipmentId: string
  lines: ShipmentLine[]
  onLines: (lines: ShipmentLine[]) => void
}) {
  const unmatched = lines.filter((l) => l.match_status !== 'matched')
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'invoice' | 'save' | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    fetch('/admin/api/shipments/new-products')
      .then((r) => r.json())
      .then((j) => setGroups(j.groups ?? []))
      .catch(() => setGroups([]))
  }, [])

  if (unmatched.length === 0) return null

  // Derived, not seeded into state by an effect: the stored row is the
  // default and `drafts` holds only what the admin has actually typed. A
  // stored name may already carry a pack spec, so it's split back apart for
  // editing and re-assembled on save.
  function draftFor(line: ShipmentLine): Draft {
    const override = drafts[line.id]
    if (override) return override
    const parsed = parseProductName(line.proposed_name ?? '')
    return {
      descriptor: parsed.base,
      category: line.proposed_category ?? '',
      priceDollars: line.proposed_price_cents != null ? (line.proposed_price_cents / 100).toFixed(2) : '',
      piecesPerPack:
        line.proposed_pieces_per_pack != null
          ? String(line.proposed_pieces_per_pack)
          : parsed.spec
            ? String(parsed.spec.piecesPerPack)
            : '',
    }
  }

  function setDraft(line: ShipmentLine, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [line.id]: { ...draftFor(line), ...patch } }))
  }

  /**
   * The full house-standard name, assembled only when the pack split is known
   * and divides the case evenly — cs.N must equal pk x bx, so a pk that
   * doesn't divide the case total can't produce a valid name.
   */
  function finalName(line: ShipmentLine): { name: string; note: string | null } {
    const draft = draftFor(line)
    if (!draft.descriptor.trim()) return { name: '', note: 'needs a name' }
    const descriptor = draft.descriptor.trim()
    const cs = line.pieces_per_case
    const pk = Number(draft.piecesPerPack)

    if (!cs) return { name: descriptor, note: 'no pieces-per-case on the sheet — no pack spec will be added' }
    if (!draft.piecesPerPack) return { name: descriptor, note: `${cs} per case — enter pieces per pack to add the spec` }
    if (!Number.isInteger(pk) || pk <= 0) return { name: descriptor, note: 'pieces per pack must be a whole number' }
    if (cs % pk !== 0) return { name: descriptor, note: `${pk} doesn't divide ${cs} evenly — cs.N must equal pk × bx` }

    return { name: buildProductName({ descriptor, piecesPerPack: pk, boxesPerCase: cs / pk }), note: null }
  }

  async function attachInvoice(file: File) {
    setError(null)
    setFlash(null)
    setBusy('invoice')
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const wb = XLSX.read(data, { type: 'array' })
      // The invoice table sits under the supplier letterhead; the server
      // finds the header row, so every sheet's grid is offered.
      const sheet = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null })).find(
        (rows) =>
          (rows as unknown[][]).some(
            (r) => Array.isArray(r) && r.some((c) => typeof c === 'string' && c.toLowerCase().includes('descriptions of goods')),
          ),
      )
      if (!sheet) {
        setError('No "Descriptions of Goods" table in that workbook — is it the Commercial Invoice rather than the Packing List?')
        return
      }

      const res = await fetch('/admin/api/shipments/new-products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipmentId, rows: sheet }),
      })
      const err = await readApiError(res, 'Could not read the invoice.')
      if (err) {
        setError(err)
        return
      }
      const json = await res.json()
      onLines(json.lines ?? [])
      setDrafts({})
      setFlash(
        `Invoice read: ${json.invoiceLines} lines, ${json.totalCartons ?? '?'} cartons, ${json.totalPieces ?? '?'} pieces. ` +
          `Matched ${json.matched} shipment line(s); proposed ${json.proposed} name(s).`,
      )
    } catch {
      setError('Could not read that workbook.')
    } finally {
      setBusy(null)
    }
  }

  async function saveDrafts() {
    setError(null)
    setBusy('save')
    try {
      const payload = unmatched.map((line) => {
        const draft = draftFor(line)
        const { name } = finalName(line)
        return {
          id: line.id,
          proposed_name: name || null,
          proposed_category: draft.category || null,
          proposed_price_cents: draft.priceDollars ? Math.round(Number(draft.priceDollars) * 100) : null,
          proposed_pieces_per_pack: draft.piecesPerPack ? Number(draft.piecesPerPack) : null,
        }
      })
      const res = await fetch('/admin/api/shipments/new-products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: payload }),
      })
      const err = await readApiError(res, 'Could not save.')
      if (err) {
        setError(err)
        return
      }
      setFlash('Draft products saved.')
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(null)
    }
  }

  async function createSelected() {
    setError(null)
    setFlash(null)
    setBusy('create')
    try {
      // Save first — the server creates from stored values, not this form.
      await saveDrafts()
      const res = await fetch('/admin/api/shipments/new-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipmentId, line_ids: [...selected] }),
      })
      const err = await readApiError(res, 'Could not create the products.')
      if (err) {
        setError(err)
        return
      }
      const json = await res.json()
      onLines(json.lines ?? [])
      setSelected(new Set())
      const failed = json.failed?.length ? ` ${json.failed.length} failed: ${json.failed.map((f: { sku: string }) => f.sku).join(', ')}.` : ''
      setFlash(`Created ${json.created?.length ?? 0} product(s) in Erply.${failed} ${json.note}`)
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(null)
    }
  }

  const creatable = unmatched.filter((l) => !l.erply_created_product_id)

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            New products ({creatable.length} not in the catalog)
          </h2>
          <p className="text-sm text-gray-500">
            The packing list has no English name, category or price. Attach the container&apos;s Commercial Invoice to
            propose names, then review every row before creating it in Erply.
          </p>
        </div>
        <label className="shrink-0 cursor-pointer rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          {busy === 'invoice' ? 'Reading…' : 'Attach Commercial Invoice'}
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={busy !== null}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) attachInvoice(f)
            }}
          />
        </label>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap text-red-700">{error}</div>}
      {flash && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{flash}</div>}

      <div className="space-y-3">
        {unmatched.map((line) => {
          const draft = draftFor(line)
          const created = !!line.erply_created_product_id
          const { name, note } = finalName(line)
          const ready = !created && !!name && !!draft.category && !!draft.priceDollars

          return (
            <div
              key={line.id}
              className={`rounded-xl border p-4 ${created ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">
                    {!created && (
                      <input
                        type="checkbox"
                        className="mr-2 align-middle"
                        checked={selected.has(line.id)}
                        disabled={!ready}
                        onChange={(e) => {
                          const next = new Set(selected)
                          if (e.target.checked) next.add(line.id)
                          else next.delete(line.id)
                          setSelected(next)
                        }}
                      />
                    )}
                    {line.sku}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {line.qty_shipped} pcs
                      {line.cartons ? ` · ${line.cartons} cartons` : ''}
                      {line.pieces_per_case ? ` · ${line.pieces_per_case}/case` : ''}
                    </span>
                  </p>
                  {line.invoice_description ? (
                    <p className="mt-0.5 text-xs text-gray-500">
                      Invoice line {line.invoice_line_no}: “{line.invoice_description}”
                      {line.invoice_match_basis && (
                        <span className="ml-1 text-gray-400">({BASIS_LABEL[line.invoice_match_basis] ?? line.invoice_match_basis})</span>
                      )}
                      {line.invoice_unit_price_cents != null && (
                        <span className="ml-1 text-gray-400">· cost ${(line.invoice_unit_price_cents / 100).toFixed(2)}</span>
                      )}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-amber-700">
                      No invoice line matched this SKU — name it by hand.
                    </p>
                  )}
                  {line.match_status === 'barcode_mismatch' && (
                    <p className="mt-0.5 text-xs text-red-600">
                      The sheet&apos;s UPC disagrees with the barcode on file — check the SKU mapping before creating this.
                    </p>
                  )}
                </div>

                {created ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    Created in Erply · #{line.erply_created_product_id}
                  </span>
                ) : (
                  line.create_error && (
                    <span className="max-w-xs text-xs text-red-600">{line.create_error}</span>
                  )
                )}
              </div>

              {!created && (
                <>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-sm lg:col-span-2">
                      <span className="text-xs font-medium text-gray-600">Product name (no pack spec)</span>
                      <input
                        value={draft.descriptor}
                        onChange={(e) => setDraft(line, { descriptor: e.target.value })}
                        placeholder="e.g. Wine Flower Decorative 6-in-1 Set 25cm"
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs font-medium text-gray-600">Category (Erply group)</span>
                      <select
                        value={draft.category}
                        onChange={(e) => setDraft(line, { category: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                      >
                        <option value="">— choose —</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.name}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-sm">
                        <span className="text-xs font-medium text-gray-600">Price (USD)</span>
                        <input
                          value={draft.priceDollars}
                          onChange={(e) => setDraft(line, { priceDollars: e.target.value })}
                          inputMode="decimal"
                          placeholder="0.00"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="text-xs font-medium text-gray-600">Pieces/pack</span>
                        <input
                          value={draft.piecesPerPack}
                          onChange={(e) => setDraft(line, { piecesPerPack: e.target.value })}
                          inputMode="numeric"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                        />
                      </label>
                    </div>
                  </div>

                  <p className="mt-2 text-xs">
                    <span className="text-gray-500">Will be created as: </span>
                    <span className="font-mono text-gray-900">{name || '—'}</span>
                    {note && <span className="ml-2 text-amber-700">({note})</span>}
                  </p>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={createSelected}
          disabled={busy !== null || selected.size === 0}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy === 'create' ? 'Creating…' : `Create ${selected.size} product(s) in Erply`}
        </button>
        <button
          onClick={saveDrafts}
          disabled={busy !== null}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === 'save' ? 'Saving…' : 'Save drafts'}
        </button>
        <p className="text-xs text-gray-500">
          Creating is one-way — a product can&apos;t be un-created from here. Stock is still applied separately above.
        </p>
      </div>
    </div>
  )
}
