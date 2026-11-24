import { describe, it, expect } from 'vitest'
import {
  blockersForDelete,
  containerRefFromFileName,
  findContentMatches,
  neighbourSkus,
  pickNeighbourSpec,
  retailCentsFromQb,
  findDuplicateRegistrations,
  isCreatable,
  isStockAppliable,
  missingForCreate,
  summariseShipment,
  type SummaryLine,
  type ReceivingLine,
} from '@/lib/receiving'

const line = (over: Partial<ReceivingLine> = {}): ReceivingLine => ({
  match_status: 'matched',
  qty_received: 10,
  applied_at: null,
  erply_created_product_id: null,
  ...over,
})

describe('isStockAppliable', () => {
  it('accepts a matched line with pieces that has not been applied', () => {
    expect(isStockAppliable(line())).toBe(true)
  })

  it('refuses a line that was already applied', () => {
    // Erply's registration API is a delta, so a second apply doubles stock.
    expect(isStockAppliable(line({ applied_at: '2026-09-16T00:00:00Z' }))).toBe(false)
  })

  it('refuses a zero received count', () => {
    expect(isStockAppliable(line({ qty_received: 0 }))).toBe(false)
  })

  it('refuses an unmatched SKU', () => {
    expect(isStockAppliable(line({ match_status: 'unmatched_sku' }))).toBe(false)
  })

  it('refuses a barcode mismatch even though the SKU exists', () => {
    // The SKU is in the catalog but the sheet's UPC disagrees, so the mapping
    // is suspect — adding stock to the wrong product is not self-correcting.
    expect(isStockAppliable(line({ match_status: 'barcode_mismatch' }))).toBe(false)
  })

  it('accepts a line whose product was just created in this pass', () => {
    // The create step re-resolves the line to 'matched'; that flip is the
    // whole reason a container can be received in one pass.
    expect(isStockAppliable(line({ match_status: 'matched', erply_created_product_id: 3081 }))).toBe(true)
  })
})

describe('isCreatable', () => {
  it('accepts a SKU that is not in the catalog', () => {
    expect(isCreatable(line({ match_status: 'unmatched_sku' }))).toBe(true)
  })

  it('refuses a barcode mismatch — that SKU already exists', () => {
    // Creating it would ask Erply for a duplicate code, or produce a second
    // product for the same item.
    expect(isCreatable(line({ match_status: 'barcode_mismatch' }))).toBe(false)
  })

  it('refuses a line already created, which is what makes retry safe', () => {
    expect(isCreatable(line({ match_status: 'unmatched_sku', erply_created_product_id: 3081 }))).toBe(false)
  })

  it('refuses a matched line', () => {
    expect(isCreatable(line())).toBe(false)
  })
})

describe('the two predicates together', () => {
  it('never allow the same line to be created and applied at once', () => {
    const states: ReceivingLine[] = [
      line({ match_status: 'matched' }),
      line({ match_status: 'unmatched_sku' }),
      line({ match_status: 'barcode_mismatch' }),
      line({ match_status: 'unmatched_sku', erply_created_product_id: 1 }),
      line({ match_status: 'matched', erply_created_product_id: 1 }),
      line({ match_status: 'matched', applied_at: '2026-09-16T00:00:00Z' }),
      line({ qty_received: 0 }),
    ]
    for (const l of states) {
      expect(isCreatable(l) && isStockAppliable(l)).toBe(false)
    }
  })
})

describe('missingForCreate', () => {
  it('lists every field Erply needs that is absent', () => {
    expect(missingForCreate(line({ match_status: 'unmatched_sku' }))).toEqual(['name', 'category', 'price'])
  })

  it('is empty when the proposal is complete', () => {
    expect(
      missingForCreate(
        line({
          match_status: 'unmatched_sku',
          proposed_name: 'Pizza Squishy - 12/pk 8bx/cs cs.96',
          proposed_category: 'Toys',
          proposed_price_cents: 199,
        }),
      ),
    ).toEqual([])
  })

  it('treats a zero price as supplied, not missing', () => {
    // A free giveaway item is a real thing; absent is the problem, not zero.
    expect(
      missingForCreate(
        line({ match_status: 'unmatched_sku', proposed_name: 'X', proposed_category: 'Toys', proposed_price_cents: 0 }),
      ),
    ).toEqual([])
  })
})

describe('blockersForDelete', () => {
  const staged = { status: 'staged' }

  it('allows deleting a staged shipment that has done nothing irreversible', () => {
    // The EMCU8323054 case: staged before the SKU-casing fix, so its
    // match_status was stale, but no stock registered and no product created.
    expect(blockersForDelete(staged, [line({ match_status: 'unmatched_sku' }), line()])).toEqual([])
  })

  it('allows deleting a shipment with no lines at all', () => {
    expect(blockersForDelete(staged, [])).toEqual([])
  })

  it('refuses once any line has registered stock', () => {
    // These rows are the only record that a one-way Erply add happened.
    // Deleting them would hide the receipt, not reverse it — and would let
    // the same file be staged and applied again.
    const blockers = blockersForDelete(staged, [line(), line({ applied_at: '2026-09-18T00:00:00Z' })])
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toMatch(/1 line\(s\) have already had their stock registered/)
  })

  it('refuses once any line created a product', () => {
    const blockers = blockersForDelete(staged, [line({ erply_created_product_id: 3081 })])
    expect(blockers[0]).toMatch(/created a product/)
  })

  it('refuses an applied shipment even if its lines look clean', () => {
    expect(blockersForDelete({ status: 'applied' }, [line()])).toEqual(['the shipment is marked applied'])
  })

  it('reports every reason at once rather than the first', () => {
    const blockers = blockersForDelete({ status: 'applied' }, [
      line({ applied_at: '2026-09-18T00:00:00Z' }),
      line({ erply_created_product_id: 3081 }),
    ])
    expect(blockers).toHaveLength(3)
  })
})

// ── Duplicate-apply guards ───────────────────────────────────────────────────

describe('containerRefFromFileName', () => {
  // Real file names from the 2026-09 containers, verbatim.
  it('pulls the container out of a supplier file name', () => {
    expect(containerRefFromFileName(
      '2026-09 ETD 0904 697ctn Arrival List ETA 09-17-2026 Cntr#EGSU8096690 MBL#EGLV143655275917 HBL#RWRD102613031973.xlsx',
    )).toBe('EGSU8096690')
    expect(containerRefFromFileName(
      '2026-08 ETD 0820 568ctn Arrival List ETA 09-02-2026 Cntr#EGSU9509206 MBL#EGLV143655274431 HBL#RWRD102613030985.xlsx',
    )).toBe('EGSU9509206')
  })

  it('ignores a second cntr# that is a carton count, not a container', () => {
    // This file really exists and carries both.
    expect(containerRefFromFileName(
      '2026-08 ETD 0814 762ctn Arrival List ETA 08-27-2026 Cntr#EGSU8749711 cntr#762 ETA 08-27-2026 MBL#EGLV143655274422 HBL#RWRD.xlsx',
    )).toBe('EGSU8749711')
  })

  it('normalises case and stray spacing', () => {
    expect(containerRefFromFileName('… cntr# egsu 8096690 MBL#…')).toBe('EGSU8096690')
  })

  it('returns null when there is no container in the name', () => {
    expect(containerRefFromFileName('random packing list.xlsx')).toBeNull()
    expect(containerRefFromFileName('')).toBeNull()
  })
})

describe('findDuplicateRegistrations', () => {
  const prior = [
    { productId: 100, amount: 2160, documentId: 44, date: '2026-09-03' },  // D701027
    { productId: 101, amount: 1056, documentId: 44, date: '2026-09-03' },  // P273810-60cm
    { productId: 102, amount: 720, documentId: 44, date: '2026-09-03' },
  ]

  it('flags a product already registered at the same amount', () => {
    const hits = findDuplicateRegistrations([{ sku: 'D701027', productId: 100, addQty: 2160 }], prior)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ sku: 'D701027', documentId: 44, date: '2026-09-03' })
  })

  it('does NOT flag the same product at a different amount', () => {
    // The real case: P273810-60cm arrived 1,056 then 372 -- two genuine
    // shipments, not a duplicate. Flagging this would have cost real stock.
    expect(findDuplicateRegistrations([{ sku: 'P273810-60cm', productId: 101, addQty: 372 }], prior)).toEqual([])
  })

  it('does not flag a product with no prior registration', () => {
    expect(findDuplicateRegistrations([{ sku: 'F288139', productId: 999, addQty: 1800 }], prior)).toEqual([])
  })

  it('reports the most recent prior document when there are several', () => {
    const many = [
      { productId: 100, amount: 500, documentId: 10, date: '2026-07-01' },
      { productId: 100, amount: 500, documentId: 30, date: '2026-08-15' },
    ]
    const hits = findDuplicateRegistrations([{ sku: 'X', productId: 100, addQty: 500 }], many)
    expect(hits[0].documentId).toBe(30)
  })

  it('handles an empty history and an empty batch', () => {
    expect(findDuplicateRegistrations([{ sku: 'X', productId: 1, addQty: 5 }], [])).toEqual([])
    expect(findDuplicateRegistrations([], prior)).toEqual([])
  })
})

describe('summariseShipment', () => {
  const l = (over: Partial<SummaryLine>): SummaryLine => ({
    sku: 'X1', match_status: 'matched', qty_received: 10, applied_at: null,
    erply_created_product_id: null, ...over,
  })

  it('counts what a container still needs', () => {
    const p = summariseShipment(
      [
        l({ sku: 'A', match_status: 'unmatched_sku', proposed_name: 'Thing' }),
        l({ sku: 'B', match_status: 'unmatched_sku' }),
        l({ sku: 'C', qty_received: 100 }),
      ],
      new Map(),
    )
    expect(p.toCreate).toBe(2)
    expect(p.named).toBe(1)
    expect(p.categorised).toBe(0)
    expect(p.appliable).toBe(1)
    expect(p.appliablePieces).toBe(100)
  })

  it('measures catalog state on the catalog, not the shipment', () => {
    // Creating a product in Erply does not put it in the catalog. That gap
    // is the whole reason this column exists.
    const lines = [
      l({ sku: 'A', erply_created_product_id: 1 }),
      l({ sku: 'B', erply_created_product_id: 2 }),
    ]
    const p = summariseShipment(lines, new Map([['A', { price_cents: 0, image_url: null }]]))
    expect(p.created).toBe(2)
    expect(p.inCatalog).toBe(1)
    expect(p.withPhoto).toBe(0)
    expect(p.priced).toBe(0)
  })

  it('counts photos and prices only for products that exist', () => {
    const p = summariseShipment(
      [l({ sku: 'A', erply_created_product_id: 1 }), l({ sku: 'B', erply_created_product_id: 2 })],
      new Map([
        ['A', { price_cents: 1200, image_url: 'https://cdn/A.jpg' }],
        ['B', { price_cents: 0, image_url: null }],
      ]),
    )
    expect(p.inCatalog).toBe(2)
    expect(p.priced).toBe(1)
    expect(p.withPhoto).toBe(1)
  })

  it('reports the invoice step as done when any line joined one', () => {
    expect(summariseShipment([l({ invoice_line_no: 7 }), l({})], new Map()).hasInvoice).toBe(true)
    expect(summariseShipment([l({}), l({})], new Map()).hasInvoice).toBe(false)
  })

  it('separates lines confirmed from the shipment being applied', () => {
    // The 2026-09-23 shape: stock registered, per-line confirmation missing.
    const p = summariseShipment([l({ applied_at: null }), l({ applied_at: null })], new Map())
    expect(p.linesConfirmed).toBe(0)
    expect(p.appliable).toBe(2)
  })

  it('handles a shipment with no lines', () => {
    const p = summariseShipment([], new Map())
    expect(p).toMatchObject({ toCreate: 0, created: 0, appliable: 0, appliablePieces: 0, inCatalog: 0 })
  })

  it('counts one SKU once even when it appears on two lines', () => {
    // K229582 really did ship on two containers.
    const p = summariseShipment(
      [l({ sku: 'K229582', erply_created_product_id: 5 }), l({ sku: 'K229582', erply_created_product_id: 5 })],
      new Map([['K229582', { price_cents: 100, image_url: 'x' }]]),
    )
    expect(p.created).toBe(2)
    expect(p.inCatalog).toBe(1)
  })
})

describe('summariseShipment — price agreement', () => {
  const l = (over: Partial<SummaryLine>): SummaryLine => ({
    sku: 'X1', match_status: 'matched', qty_received: 10, applied_at: null,
    erply_created_product_id: 7, ...over,
  })

  it('flags a catalog price that disagrees with the intended one', () => {
    const p = summariseShipment(
      [l({ sku: 'A', proposed_price_cents: 1200 })],
      new Map([['A', { price_cents: 950, image_url: null }]]),
    )
    expect(p.priceMismatch).toBe(1)
    expect(p.noPriceIntent).toBe(0)
  })

  it('does not flag a product that simply is not priced yet', () => {
    // Unpriced is what `priced` already reports; calling it a mismatch too
    // would report one gap twice.
    const p = summariseShipment(
      [l({ sku: 'A', proposed_price_cents: 1200 })],
      new Map([['A', { price_cents: 0, image_url: null }]]),
    )
    expect(p.priceMismatch).toBe(0)
    expect(p.priced).toBe(0)
  })

  it('counts a missing intent separately from a mismatch', () => {
    // Every product created so far is in this state: created at 0, with
    // nothing recording what it was meant to cost.
    const p = summariseShipment(
      [l({ sku: 'A' }), l({ sku: 'B', proposed_price_cents: 0 })],
      new Map([['A', { price_cents: 500, image_url: null }]]),
    )
    expect(p.noPriceIntent).toBe(2)
    expect(p.priceMismatch).toBe(0)
  })

  it('is quiet when intent and catalog agree', () => {
    const p = summariseShipment(
      [l({ sku: 'A', proposed_price_cents: 1200 })],
      new Map([['A', { price_cents: 1200, image_url: null }]]),
    )
    expect(p.priceMismatch).toBe(0)
    expect(p.noPriceIntent).toBe(0)
  })

  it('takes one intent for a SKU that shipped on two containers', () => {
    const p = summariseShipment(
      [l({ sku: 'K229582', proposed_price_cents: 300 }), l({ sku: 'K229582', proposed_price_cents: 300 })],
      new Map([['K229582', { price_cents: 300, image_url: null }]]),
    )
    expect(p.priceMismatch).toBe(0)
    expect(p.noPriceIntent).toBe(0)
  })
})

describe('findContentMatches', () => {
  const lines = Array.from({ length: 10 }, (_, i) => ({ sku: `P${100 + i}`, qtyShipped: 24 }))
  const prior = (id: string, n: number, qty = 24) =>
    Array.from({ length: n }, (_, i) => ({ shipment_id: id, sku: `p${100 + i}`, qty_shipped: qty }))

  it('matches a re-export of the same container, case-insensitively', () => {
    const hits = findContentMatches(lines, prior('a', 10), new Map([['a', 10]]))
    expect(hits).toEqual([{ shipmentId: 'a', matched: 10, share: 1 }])
  })

  it('tolerates a few corrected lines (Original vs Arrival List)', () => {
    const rows = [...prior('a', 8), { shipment_id: 'a', sku: 'P108', qty_shipped: 12 }]
    expect(findContentMatches(lines, rows, new Map([['a', 10]]))[0]).toMatchObject({ matched: 8, share: 0.8 })
  })

  it('ignores the same SKUs at different quantities', () => {
    expect(findContentMatches(lines, prior('a', 10, 36), new Map([['a', 10]]))).toEqual([])
  })

  it('measures against the larger shipment, so a small overlap with a big container is not a match', () => {
    expect(findContentMatches(lines, prior('a', 10), new Map([['a', 40]]))).toEqual([])
  })

  it('returns nothing for an empty file', () => {
    expect(findContentMatches([], prior('a', 10), new Map([['a', 10]]))).toEqual([])
  })
})

describe('retailCentsFromQb', () => {
  it('is the QuickBooks base price x2.4, rounded to the quarter, never .75', () => {
    expect(retailCentsFromQb(1.25)).toBe(300)
    expect(retailCentsFromQb(2)).toBe(500) // 4.80 -> 5.00
    expect(retailCentsFromQb(14.5)).toBe(3500) // 34.80 -> 35.00
    expect(retailCentsFromQb(4.5)).toBe(1100) // 10.80 -> 11.00
    expect(retailCentsFromQb(1.1)).toBe(250) // 2.64 -> 2.50
  })
})

describe('neighbourSkus', () => {
  it('lists same-prefix SKUs within the radius, keeping the digit width', () => {
    expect(neighbourSkus('F287625', 2)).toEqual(['F287623', 'F287624', 'F287626', 'F287627'])
    expect(neighbourSkus('K0003', 2)).toEqual(['K0001', 'K0002', 'K0004', 'K0005'])
    expect(neighbourSkus('P273810-60CM')).toEqual([])
  })
})

describe('pickNeighbourSpec', () => {
  const catalog = [
    { sku: 'F288116', name: 'Pink Paper - 20/pk 60bx/cs cs.60' },
    { sku: 'F288118', name: 'Odd Paper - 60/pk 1bx/cs cs.60' },
    { sku: 'F288132', name: 'Teal Paper - 20/pk 60bx/cs cs.60' },
    { sku: 'F288110', name: 'Ribbon - 1/pk 150bx/cs cs.150' },
    { sku: 'F288111', name: 'No spec at all' },
    { sku: 'G288113', name: 'Other prefix - 20/pk 60bx/cs cs.60' },
  ]

  it('takes the spec most neighbours share, named by the nearest', () => {
    expect(pickNeighbourSpec('F288125', 60, catalog)).toEqual({ sku: 'F288132', piecesPerPack: 20, boxesPerCase: 60, caseTotal: 60, count: 2 })
  })

  it('only borrows a spec whose cs.N matches the packing list', () => {
    expect(pickNeighbourSpec('F288112', 150, catalog)).toMatchObject({ sku: 'F288110', caseTotal: 150 })
    expect(pickNeighbourSpec('F288112', 72, catalog)).toBeNull()
    expect(pickNeighbourSpec('F288112', null, catalog)).toBeNull()
  })
})
