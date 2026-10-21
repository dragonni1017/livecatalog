import { describe, expect, it } from 'vitest'
import { bestLinesFromSheets, buildContainerReport, missingSkuKeys, pickRecentContainers, type ContainerSkus } from '../lib/container-check'

describe('pickRecentContainers', () => {
  // Real name shapes from the OneDrive "import documents" folder.
  const names = [
    '2026-09 ETD 0914 976ctn Arrival List ETA 10-02-2026 Cntr#TLLU5419845 MBL#X.xlsx',
    '2026-09 ETD 0914 976ctn Original List Cntr#TLLU5419845.xlsx',
    '2026-09 ETD 0914 976ctn Packing List Cntr#TLLU5419845.xlsx',
    '2026-09 ETD 0927 500ctn Original List Cntr#EGSU9777282.xls',
    '2026-08 ETD 0814 300ctn Arrival List cntr#EGSU8096690 cntr#762.xlsx',
    '2027-01 ETD 0131 120ctn Original List Cntr#EGSU9679727.xlsx',
    'notes.docx',
    'Arrival List without the prefix Cntr#ABCD1234567.xlsx',
  ]

  it('orders newest first, prefers the Arrival List, and ignores what does not fit', () => {
    expect(pickRecentContainers(names, 10)).toEqual([
      { ref: 'EGSU9679727', etd: '2027-01-31', files: ['2027-01 ETD 0131 120ctn Original List Cntr#EGSU9679727.xlsx'] },
      { ref: 'EGSU9777282', etd: '2026-09-27', files: ['2026-09 ETD 0927 500ctn Original List Cntr#EGSU9777282.xls'] },
      {
        ref: 'TLLU5419845',
        etd: '2026-09-14',
        files: [names[0], names[1]],
      },
      { ref: 'EGSU8096690', etd: '2026-08-14', files: [names[4]] },
    ])
  })

  it('takes only the newest count', () => {
    expect(pickRecentContainers(names, 2).map((c) => c.ref)).toEqual(['EGSU9679727', 'EGSU9777282'])
  })
})

describe('bestLinesFromSheets', () => {
  const header = ['货号', '条码', '箱数', '总PCS']
  it('takes the tab with the most lines and skips one that fails', () => {
    const one = [header, ['A1', null, 1, 10]]
    const two = [header, ['B1', null, 1, 10], ['B2', null, 2, 20]]
    const junk = [['nothing', 'here']]
    const { lines, error } = bestLinesFromSheets([junk, one, two])
    expect(error).toBeNull()
    expect(lines!.map((l) => l.sku)).toEqual(['B1', 'B2'])
  })

  it('reports the error when no tab parses', () => {
    const r = bestLinesFromSheets([[['nothing']]])
    expect(r.lines).toBeNull()
    expect(r.error).toBeTruthy()
  })
})

describe('buildContainerReport', () => {
  const input: ContainerSkus[] = [
    { ref: 'AAAA1111111', etd: '2026-09-27', file: 'a.xlsx', error: null, skus: [{ sku: 'LIVE1', pieces: 5 }, { sku: 'new1', pieces: 10 }, { sku: 'NEW2', pieces: 1 }] },
    { ref: 'BBBB2222222', etd: '2026-09-20', file: 'b.xlsx', error: null, skus: [{ sku: 'NEW1', pieces: 20 }, { sku: 'HID1', pieces: 3 }] },
    { ref: 'CCCC3333333', etd: '2026-09-10', file: 'c.xlsx', error: 'no SKU column', skus: [] },
  ]
  const catalog = [
    { sku: 'live1', is_active: true, manually_hidden: false },
    { sku: 'HID1', is_active: true, manually_hidden: true },
    { sku: null, is_active: true, manually_hidden: false },
  ]
  // Early shipments have no container_ref; the file name carries it.
  const shipments = [
    { container_ref: null, file_name: '2026-09 ETD 0920 Original List Cntr#BBBB2222222.xlsx', status: 'staged' },
    { container_ref: 'bbbb2222222', file_name: 'x.xlsx', status: 'applied' },
    { container_ref: 'CCCC3333333', file_name: 'c.xlsx', status: 'abandoned' },
  ]

  it('marks each container and lists missing SKUs, most containers first', () => {
    const r = buildContainerReport(input, catalog, shipments, new Set(['NEW2']))
    expect(r.containers.map(({ ref, received, skus, live, hidden, missing, inErplyNotCatalog }) => ({ ref, received, skus, live, hidden, missing, inErplyNotCatalog }))).toEqual([
      { ref: 'AAAA1111111', received: 'not staged', skus: 3, live: 1, hidden: 0, missing: 2, inErplyNotCatalog: 1 },
      { ref: 'BBBB2222222', received: 'applied', skus: 2, live: 0, hidden: 1, missing: 1, inErplyNotCatalog: 0 },
      { ref: 'CCCC3333333', received: 'abandoned', skus: 0, live: 0, hidden: 0, missing: 0, inErplyNotCatalog: 0 },
    ])
    expect(r.missing).toEqual([
      { sku: 'new1', containers: ['AAAA1111111', 'BBBB2222222'], pieces: 30, inErply: false },
      { sku: 'NEW2', containers: ['AAAA1111111'], pieces: 1, inErply: true },
    ])
    expect(r.totals).toEqual({ distinct: 4, live: 1, hidden: 1, missing: 2, inErplyNotCatalog: 1 })
    expect(r.erplyChecked).toBe(true)
  })

  it('leaves inErply null when Erply was not checked', () => {
    const r = buildContainerReport(input, catalog, [], null)
    expect(r.erplyChecked).toBe(false)
    expect(r.missing.every((m) => m.inErply === null)).toBe(true)
    expect(r.containers.every((c) => c.received === 'not staged')).toBe(true)
  })

  it('missingSkuKeys gives the distinct upper-cased SKUs to ask Erply about', () => {
    expect(missingSkuKeys(input, catalog)).toEqual(['NEW1', 'NEW2'])
  })
})
