'use client'

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { buildProductName, parseProductName } from '@/lib/product-naming'
import { isCreatable, missingForCreate } from '@/lib/receiving'
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
  // A created line now reads 'matched' (that's what makes its stock
  // appliable), so it's kept in this list explicitly — otherwise it would
  // vanish the moment it was created, taking its Erply product ID and any
  // price warning with it.
  const unmatched = lines.filter((l) => l.match_status !== 'matched' || l.erply_created_product_id)
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkCategory, setBulkCategory] = useState('')
  const [bulkPrice, setBulkPrice] = useState('')
  const [busy, setBusy] = useState<'invoice' | 'save' | 'create' | 'catalog' | 'photos' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  // SKU + intended price for every product just created, since Erply won't
  // take a price through its API on this account (see lib/erply.ts).
  const [priceWorklist, setPriceWorklist] = useState<string[]>([])
  const [copied, setCopied] = useState(false)

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

  /**
   * Fill one field across every creatable row that is still missing it.
   *
   * Scoped to rows WITHOUT a value rather than all rows, and deliberately not
   * driven by the row checkboxes: those are disabled until a row is complete,
   * which is precisely the state this is meant to fix. Not overwriting means
   * a deliberate per-row choice survives a careless click on a 20-row
   * colourway run.
   */
  function fillMissing(field: 'category' | 'priceDollars', value: string) {
    if (!value) return
    setDrafts((prev) => {
      const next = { ...prev }
      for (const line of creatable) {
        const current = next[line.id] ?? draftFor(line)
        if (current[field]) continue
        next[line.id] = { ...current, [field]: value }
      }
      return next
    })
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

  // Creating a product puts it in Erply, not the catalog. Until this
  // existed that last hop was a script, so a finished container could sit
  // invisible with nothing to say why.
  async function addToCatalog() {
    setError(null)
    setFlash(null)
    setBusy('catalog')
    try {
      const res = await fetch('/admin/api/shipments/to-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipmentId }),
      })
      const err = await readApiError(res, 'Could not add the products to the catalog.')
      if (err) {
        setError(err)
        return
      }
      const json = await res.json()
      const notes: string[] = []
      if (json.skippedPriced?.length) notes.push(`${json.skippedPriced.length} already priced in Erply — the sync owns those.`)
      if (json.notInErply?.length) notes.push(`${json.notInErply.length} could not be read back from Erply.`)
      if (json.noCategory?.length) notes.push(`${json.noCategory.length} had no matching category.`)
      if (json.failures?.length) {
        setError(`Some rows failed: ${json.failures.join('; ')}`)
        return
      }
      setFlash([json.note, ...notes].join(' '))
      onLines(lines)
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(null)
    }
  }

  // The photos for a container arrive as a folder named by SKU. Matching is
  // lib/photo-matching.ts, the same module the scripts use, so this cannot
  // decide a file belongs to a product they would disagree about.
  async function uploadPhotos(files: FileList) {
    setError(null)
    setFlash(null)
    setBusy('photos')
    try {
      const body = new FormData()
      body.append('shipment_id', shipmentId)
      for (const f of Array.from(files)) body.append('files', f)
      const res = await fetch('/admin/api/shipments/photos', { method: 'POST', body })
      const err = await readApiError(res, 'Could not upload the photos.')
      if (err) {
        setError(err)
        return
      }
      const json = await res.json()
      if (json.failures?.length) {
        setError(`Some photos failed: ${json.failures.join('; ')}`)
        return
      }
      const notes: string[] = []
      if (json.skippedHaveImage?.length) notes.push(`${json.skippedHaveImage.length} already had a photo.`)
      if (json.unmatchedCount) notes.push(`${json.unmatchedCount} matched no SKU on this shipment.`)
      setFlash([`Uploaded photos for ${json.uploaded} product(s).`, ...notes].join(' '))
      onLines(lines)
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

      // Erply discards a price sent through its API on this account, so the
      // prices just approved have to be typed in by hand (Dragon's call
      // 2026-09-16). Build that worklist here rather than making someone read
      // it back off individual rows.
      const createdSkus: string[] = (json.created ?? []).map((c: { sku: string }) => c.sku)
      const worklist = ((json.lines ?? []) as ShipmentLine[])
        .filter((l) => createdSkus.includes(l.sku) && l.proposed_price_cents != null)
        .map((l) => `${l.sku}\t${((l.proposed_price_cents as number) / 100).toFixed(2)}`)
      setPriceWorklist(worklist)
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(null)
    }
  }

  const creatable = unmatched.filter(isCreatable)
  // Lines that produced an Erply product, which is what the catalog hop
  // acts on -- a SKU can appear on two lines, so the route de-duplicates.
  const created = lines.filter((l) => l.erply_created_product_id)
  // Counted from the drafts, not the saved rows, so the buttons disappear as
  // soon as the gap is filled rather than after a save.
  const missingCategory = creatable.filter((l) => !draftFor(l).category)
  const missingPrice = creatable.filter((l) => !draftFor(l).priceDollars)
  // Only nag when there is something the invoice would actually answer, and
  // when no line on this shipment has been matched to an invoice line yet.
  // invoice_line_no rather than the description: a row can legitimately join
  // an invoice line that carries no description, and that still counts as
  // having run the step.
  const needsInvoice =
    creatable.length > 0 && !unmatched.some((l) => l.invoice_line_no != null)

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

      {/* Offered once something has actually been created. The count is of
          lines, not products, so it says "from this shipment" rather than a
          number that would disagree with the catalog. */}
      {created.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addToCatalog}
            disabled={busy !== null}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === 'catalog' ? 'Adding…' : 'Add created products to the catalog'}
          </button>
          <label className="cursor-pointer rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            {busy === 'photos' ? 'Uploading…' : 'Upload photos for this container'}
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              multiple
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                if (e.target.files?.length) uploadPhotos(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          <span className="text-xs text-gray-500">
            They go in hidden — a product with no price is orderable at $0, so pricing in Erply is what makes them
            visible.
          </span>
        </div>
      )}

      {/* The invoice step is optional, easy to skip, and skipping it is
          invisible until much later. As of 2026-09-24 it had never been run:
          0 of 231 shipment lines carried an invoice_line_no, description or
          unit price, across six received containers. The cost shows up at
          pricing time -- invoice_unit_price_cents is the only landed cost
          this system ever sees, so without it every one of those products
          has to be priced from a guess at a sibling SKU. Hence a prompt
          rather than just a button. */}
      {needsInvoice && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">No Commercial Invoice attached yet.</span> These {creatable.length} SKU
          {creatable.length === 1 ? '' : 's'} have no English name, and nothing here records what they cost. Attaching
          the invoice fills the names and descriptions, and stores each line&apos;s unit price — which is what a price
          is decided from later. Without it, pricing falls back to guessing from similar SKUs.
        </div>
      )}

      {/* A colourway run is the normal case: 20 FD400*-25YARD ribbons on one
          container, all the same category and usually the same price. Doing
          that per row was 3 fields x 85 products on the 2026-09-23 batch. */}
      {(missingCategory.length > 1 || missingPrice.length > 1) && (
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <p className="w-full text-xs font-medium text-gray-600">
            Fill the rows that are still blank — anything already set is left alone.
          </p>
          {missingCategory.length > 1 && (
            <div className="flex items-end gap-2">
              <label className="text-sm">
                <span className="text-xs text-gray-600">Category</span>
                <select
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  className="mt-1 block rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                >
                  <option value="">— choose —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.name}>{g.name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!bulkCategory || busy !== null}
                onClick={() => { fillMissing('category', bulkCategory); setBulkCategory('') }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Set on {missingCategory.length} rows
              </button>
            </div>
          )}
          {missingPrice.length > 1 && (
            <div className="flex items-end gap-2">
              <label className="text-sm">
                <span className="text-xs text-gray-600">Price (USD)</span>
                <input
                  value={bulkPrice}
                  onChange={(e) => setBulkPrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="mt-1 block w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={!bulkPrice || busy !== null}
                onClick={() => { fillMissing('priceDollars', bulkPrice); setBulkPrice('') }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Set on {missingPrice.length} rows
              </button>
            </div>
          )}
        </div>
      )}

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm whitespace-pre-wrap text-red-700">{error}</div>}
      {flash && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{flash}</div>}

      {/* The one thing creating a product can't do for you. Kept as
          tab-separated text so it pastes straight into a spreadsheet. */}
      {priceWorklist.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Set these {priceWorklist.length} price{priceWorklist.length !== 1 ? 's' : ''} in Erply by hand
              </p>
              <p className="mt-0.5 text-xs text-amber-800">
                Erply ignores a price sent through its API on this account, so the products were created without one.
                Until these are set, they are $0.00.
              </p>
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(priceWorklist.join('\n')).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }}
              className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              {copied ? 'Copied' : 'Copy list'}
            </button>
          </div>
          <pre className="mt-3 max-h-48 overflow-auto rounded border border-amber-200 bg-white px-3 py-2 text-xs text-gray-800">
{priceWorklist.join('\n')}
          </pre>
        </div>
      )}

      <div className="space-y-3">
        {unmatched.map((line) => {
          const draft = draftFor(line)
          const created = !!line.erply_created_product_id
          const { name, note } = finalName(line)
          // Same rule the route enforces, so the checkbox can't offer a line
          // the server will reject.
          const ready =
            isCreatable(line) &&
            missingForCreate({
              ...line,
              proposed_name: name || null,
              proposed_category: draft.category || null,
              proposed_price_cents: draft.priceDollars ? Math.round(Number(draft.priceDollars) * 100) : null,
            }).length === 0

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
                        <span
                          className="text-xs font-medium text-gray-600"
                          title="Erply ignores a price sent through its API on this account, so this is recorded here and typed into Erply by hand. Required, because it's the worklist for that pass."
                        >
                          Intended price (USD) *
                        </span>
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
          Creating is one-way — a product can&apos;t be un-created from here. Prices are recorded here but set in Erply
          by hand, and you&apos;ll get the list to work through afterwards. Once created, apply the stock above.
        </p>
      </div>
    </div>
  )
}
