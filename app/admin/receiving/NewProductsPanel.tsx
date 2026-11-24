'use client'

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { buildProductName, packSpecConvention, parseProductName } from '@/lib/product-naming'
import {
  describePackSpec as describeSpecWords,
  isCreatable,
  missingForCreate,
  QB_TO_RETAIL,
  retailCentsFromQb,
  type NeighbourSpec,
} from '@/lib/receiving'
import type { ShipmentLine } from './ReceivingUpload'
import type { QbLineStatus } from '@/app/admin/api/shipments/qb-status/route'

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
  /** The three pack-spec figures, as typed: "<pk>/pk <bx>bx/cs cs.<cs>". */
  piecesPerPack: string
  packsPerCase: string
  caseTotal: string
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

  // QuickBooks status per upper-cased SKU, tagged with the shipment it was
  // loaded for so switching shipments never shows the previous one's. null =
  // not loaded (or failed), in which case the rows don't mention QuickBooks.
  const [qbLoaded, setQbLoaded] = useState<{
    shipmentId: string
    status: Record<string, QbLineStatus> | null
    neighbours: Record<string, NeighbourSpec>
  } | null>(null)
  const qb = qbLoaded?.shipmentId === shipmentId ? qbLoaded.status : null
  const neighbours = qbLoaded?.shipmentId === shipmentId ? qbLoaded.neighbours : {}

  useEffect(() => {
    fetch('/admin/api/shipments/new-products')
      .then((r) => r.json())
      .then((j) => setGroups(j.groups ?? []))
      .catch(() => setGroups([]))
  }, [])

  useEffect(() => {
    fetch(`/admin/api/shipments/qb-status?shipment_id=${encodeURIComponent(shipmentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) =>
        setQbLoaded({ shipmentId, status: j && !j.directoryEmpty ? (j.status ?? null) : null, neighbours: j?.neighbours ?? {} }),
      )
      .catch(() => setQbLoaded({ shipmentId, status: null, neighbours: {} }))
  }, [shipmentId])

  if (unmatched.length === 0) return null

  // Derived, not seeded into state by an effect: the stored row is the
  // default and `drafts` holds only what the admin has actually typed. A
  // stored name may already carry a pack spec, so it's split back apart for
  // editing and re-assembled on save.
  function draftFor(line: ShipmentLine): Draft {
    const override = drafts[line.id]
    if (override) return override
    const parsed = parseProductName(line.proposed_name ?? '')
    const spec = specDefaults(line)
    return {
      descriptor: parsed.base,
      category: line.proposed_category ?? '',
      priceDollars: line.proposed_price_cents != null ? (line.proposed_price_cents / 100).toFixed(2) : '',
      piecesPerPack: spec.piecesPerPack,
      packsPerCase: spec.packsPerCase,
      caseTotal: spec.caseTotal,
    }
  }

  /**
   * Starting pc/pk · pk/cs · cs.#, and where they came from, in order:
   *  1. the saved name's own spec;
   *  2. pc/pk stated in the packing list's text ("20张/包"), whose per-case
   *     figure then counts packs (case_counts_packs, migration 0079);
   *  3. QuickBooks' description ("20/pk", "60 pks/cs");
   *  4. the spec most catalog neighbours with the same cs.# use
   *     (pickNeighbourSpec) — what all 17 floral papers on BSIU8114429 get.
   * cs.# is always the packing list's per-case figure: it is cs.N under both
   * naming conventions. Blank pk/cs on a piece-sold row is worked out as
   * cs.# ÷ pc/pk (derivedPacksPerCase).
   */
  function specDefaults(line: ShipmentLine): {
    piecesPerPack: string
    packsPerCase: string
    caseTotal: string
    source: string | null
  } {
    const parsed = parseProductName(line.proposed_name ?? '').spec
    if (parsed) {
      return {
        piecesPerPack: String(parsed.piecesPerPack),
        packsPerCase: String(parsed.boxesPerCase),
        caseTotal: String(parsed.piecesPerCase),
        source: null,
      }
    }
    const key = line.sku.toUpperCase()
    const q = qb?.[key]
    const nb = neighbours[key]
    const sheetCase = line.pieces_per_case != null ? String(line.pieces_per_case) : ''
    const str = (n: number | null | undefined) => (n == null ? '' : String(n))
    // Packs per case when something says the sheet counts packs.
    const packsIfPackSold = line.case_counts_packs || q?.soldBy === 'pack' ? sheetCase : ''
    // A neighbour with the same pc/pk also tells us pk/cs (covers lines staged
    // before migration 0079, which have pc/pk but no case_counts_packs).
    const nbPacks = (pk: number) => (nb && nb.piecesPerPack === pk ? String(nb.boxesPerCase) : '')

    if (line.proposed_pieces_per_pack != null) {
      const pk = line.proposed_pieces_per_pack
      return {
        piecesPerPack: String(pk),
        packsPerCase: packsIfPackSold || str(q?.packsPerCase) || nbPacks(pk),
        caseTotal: sheetCase,
        source: line.case_counts_packs ? 'the packing list' : null,
      }
    }
    if (q?.perPack) {
      return {
        piecesPerPack: String(q.perPack),
        packsPerCase: str(q.packsPerCase) || packsIfPackSold || nbPacks(q.perPack),
        caseTotal: sheetCase,
        source: 'QuickBooks',
      }
    }
    if (nb) {
      return {
        piecesPerPack: String(nb.piecesPerPack),
        packsPerCase: String(nb.boxesPerCase),
        caseTotal: String(nb.caseTotal),
        source: `${nb.sku}${nb.count > 1 ? ` and ${nb.count - 1} other nearby product${nb.count > 2 ? 's' : ''}` : ''}`,
      }
    }
    return { piecesPerPack: '', packsPerCase: packsIfPackSold, caseTotal: sheetCase, source: packsIfPackSold ? 'QuickBooks' : null }
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
   * pk/cs actually used: as typed, or — left blank on a piece-sold row —
   * cs.# ÷ pc/pk when that divides evenly. Shown as the box's placeholder.
   */
  function describePackSpec(draft: Draft): string | null {
    const bx = draft.packsPerCase.trim() ? Number(draft.packsPerCase) : derivedPacksPerCase(draft)
    return bx == null ? null : describeSpecWords(Number(draft.piecesPerPack), bx, Number(draft.caseTotal))
  }

  function derivedPacksPerCase(draft: Draft): number | null {
    const pk = Number(draft.piecesPerPack)
    const cs = Number(draft.caseTotal)
    if (draft.packsPerCase.trim() || !pk || !cs || cs % pk !== 0) return null
    return cs / pk
  }

  /**
   * The full house-standard name from the three typed figures. The spec is
   * only added when it satisfies one of the two conventions in
   * lib/product-naming.ts: cs.# = pc/pk × pk/cs (sold by the piece) or
   * cs.# = pk/cs (sold by the pack, e.g. floral paper "60/pk 60bx/cs cs.60").
   */
  function finalName(line: ShipmentLine): { name: string; note: string | null } {
    const draft = draftFor(line)
    if (!draft.descriptor.trim()) return { name: '', note: 'needs a name' }
    const descriptor = draft.descriptor.trim()
    if (!draft.piecesPerPack.trim()) return { name: descriptor, note: 'fill in the pack size to add it to the name' }

    const pk = Number(draft.piecesPerPack)
    const bx = draft.packsPerCase.trim() ? Number(draft.packsPerCase) : derivedPacksPerCase(draft)
    const cs = Number(draft.caseTotal)
    const whole = (n: number | null) => n != null && Number.isInteger(n) && n > 0
    if (!whole(pk) || !whole(bx) || !whole(cs)) {
      return { name: descriptor, note: 'the three pack-size boxes must be whole numbers' }
    }
    const spec = { piecesPerPack: pk, boxesPerCase: bx!, piecesPerCase: cs, caseUnit: null }
    if (packSpecConvention(spec) === 'inconsistent') {
      return {
        name: descriptor,
        note: `case count ${cs} doesn't fit: use ${bx} if it's sold by the pack, or ${pk * bx!} (${pk} × ${bx}) if it's sold by the piece`,
      }
    }

    const name = buildProductName({ descriptor, piecesPerPack: pk, boxesPerCase: bx!, caseTotal: cs })
    // Still built — the spec is valid — but the sheet's per-case figure is
    // cs.# for both conventions, so a different number is usually a typo.
    const sheet = line.pieces_per_case
    const note = sheet && sheet !== cs ? `the packing list says ${sheet} per carton, not ${cs}` : null
    return { name, note }
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
  // QuickBooks holds the old base price; x2.4 (quarter-rounded) is Retail,
  // the price the intended-price box wants. See retailCentsFromQb.
  const qbRetailCents = (line: ShipmentLine): number | null => {
    const p = qb?.[line.sku.toUpperCase()]?.salesPrice
    return p != null ? retailCentsFromQb(p) : null
  }
  const qbFillable = missingPrice.filter((l) => qbRetailCents(l) != null)

  /** Blank price boxes only, like fillMissing: a typed price is never replaced. */
  function fillPricesFromQb() {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const line of qbFillable) {
        const current = next[line.id] ?? draftFor(line)
        if (current.priceDollars) continue
        next[line.id] = { ...current, priceDollars: (qbRetailCents(line)! / 100).toFixed(2) }
      }
      return next
    })
  }
  // Only nag when there is something the invoice would actually answer, and
  // when no line on this shipment has been matched to an invoice line yet.
  // invoice_line_no rather than the description: a row can legitimately join
  // an invoice line that carries no description, and that still counts as
  // having run the step.
  const invoiceAttached = unmatched.some((l) => l.invoice_line_no != null)
  const needsInvoice = creatable.length > 0 && !invoiceAttached

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

      {qbFillable.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={fillPricesFromQb}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Fill {qbFillable.length} blank price{qbFillable.length === 1 ? '' : 's'} from QuickBooks
          </button>
          <span className="text-xs text-gray-500">
            QuickBooks price × {QB_TO_RETAIL}, rounded to the quarter = the Retail price. Review before saving: it
            matches the current catalog price for about 4 in 5 products.
          </span>
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
                    // Only said once an invoice is actually attached: before
                    // that, every row read "No invoice line matched" and was
                    // taken for a QuickBooks failure. The banner above covers
                    // the not-attached case.
                    invoiceAttached && (
                      <p className="mt-0.5 text-xs text-gray-500">Not on the attached Commercial Invoice.</p>
                    )
                  )}
                  {!created && qb && <QbNote status={qb[line.sku.toUpperCase()]} named={!!line.proposed_name} />}
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
                        {/* QuickBooks holds the old base price; the box wants
                            Retail. Shown converted, filled only on a click. */}
                        {qbRetailCents(line) != null && (
                          <span
                            className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500"
                            title={`QuickBooks still has the old base price. Retail = base × ${QB_TO_RETAIL}, rounded to the quarter (never .75).`}
                          >
                            QuickBooks ${qb![line.sku.toUpperCase()].salesPrice!.toFixed(2)} → Retail $
                            {(qbRetailCents(line)! / 100).toFixed(2)}
                            {draft.priceDollars !== (qbRetailCents(line)! / 100).toFixed(2) && (
                              <button
                                type="button"
                                onClick={() => setDraft(line, { priceDollars: (qbRetailCents(line)! / 100).toFixed(2) })}
                                className="text-red-700 underline"
                              >
                                Use
                              </button>
                            )}
                          </span>
                        )}
                      </label>
                      <div className="text-sm">
                        <span className="text-xs font-medium text-gray-600">Pack size</span>
                        <div className="mt-1 grid grid-cols-3 gap-1">
                          {(
                            [
                              ['piecesPerPack', 'Pcs in a pack', 'pc/pk', ''],
                              ['packsPerCase', 'Packs in a case', 'pk/cs', String(derivedPacksPerCase(draft) ?? '')],
                              ['caseTotal', 'Case count', 'cs.#', ''],
                            ] as const
                          ).map(([field, label, short, placeholder]) => (
                            <label key={field} className="block">
                              <span className="block text-[11px] leading-tight text-gray-500">
                                {label} <span className="text-gray-400">({short})</span>
                              </span>
                              <input
                                value={draft[field]}
                                onChange={(e) => setDraft(line, { [field]: e.target.value })}
                                placeholder={placeholder}
                                inputMode="numeric"
                                className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                              />
                            </label>
                          ))}
                        </div>
                        {/* Plain-English reading of the three boxes: which
                            unit is sold and counted in stock. */}
                        {(() => {
                          const text = describePackSpec(draft)
                          return text ? <span className="mt-0.5 block text-xs text-gray-700">{text}</span> : null
                        })()}
                        {line.pieces_per_case != null && (
                          <span className="mt-0.5 block text-xs text-gray-500">
                            Packing list:{' '}
                            {line.cartons
                              ? `${line.qty_shipped.toLocaleString()} in ${line.cartons} cartons = ${line.pieces_per_case} per carton`
                              : `${line.pieces_per_case} per carton`}
                          </span>
                        )}
                        {/* Where the starting figures came from, until
                            they're edited — so a borrowed spec is reviewed,
                            not trusted. */}
                        {!drafts[line.id] && specDefaults(line).source && (
                          <span className="mt-0.5 block text-xs text-blue-700">
                            Pre-filled from {specDefaults(line).source}
                          </span>
                        )}
                        {(() => {
                          const nb = neighbours[line.sku.toUpperCase()]
                          if (!nb) return null
                          const same =
                            draft.piecesPerPack === String(nb.piecesPerPack) &&
                            draft.packsPerCase === String(nb.boxesPerCase) &&
                            draft.caseTotal === String(nb.caseTotal)
                          if (same) return null
                          return (
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
                              Like {nb.sku}: {nb.piecesPerPack}/pk {nb.boxesPerCase}bx/cs cs.{nb.caseTotal}
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft(line, {
                                    piecesPerPack: String(nb.piecesPerPack),
                                    packsPerCase: String(nb.boxesPerCase),
                                    caseTotal: String(nb.caseTotal),
                                  })
                                }
                                className="text-red-700 underline"
                              >
                                Use
                              </button>
                            </span>
                          )
                        })()}
                      </div>
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

// One line per new SKU saying whether QuickBooks Desktop has it, from the
// mirror on /admin/quickbooks/items. Wording matches that page's buckets.
function QbNote({ status, named }: { status: QbLineStatus | undefined; named: boolean }) {
  if (!status) return null
  const fill = named ? '' : ' Use Fill names on QuickBooks → Items, or type a name.'
  switch (status.problem) {
    case null:
      return (
        <p className="mt-0.5 text-xs text-green-700">
          ✓ In QuickBooks{status.description ? `: “${status.description}”` : ''}
          {!named && <span className="text-gray-500">{fill}</span>}
        </p>
      )
    case 'missing':
      return <p className="mt-0.5 text-xs text-amber-700">Not in QuickBooks — set it up there, or name it by hand.</p>
    case 'ambiguous':
      return <p className="mt-0.5 text-xs text-amber-700">More than one QuickBooks item has this SKU — name it by hand.</p>
    case 'pack_mismatch':
      return (
        <p className="mt-0.5 text-xs text-amber-700">
          In QuickBooks, but its description quotes a different case pack — check it before naming.
        </p>
      )
    case 'no_description':
      return <p className="mt-0.5 text-xs text-amber-700">In QuickBooks, but with no description — name it by hand.</p>
    default:
      return null
  }
}
