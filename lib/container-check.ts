/**
 * Container check: which recent supplier containers never went through
 * /admin/receiving, and which of their SKUs the catalog doesn't have.
 *
 * Exists because nothing surfaced it: on 2026-10-21, 14 of the newest 21
 * containers had never been staged and 130 of their SKUs were in neither the
 * catalog nor Erply, found only by running a script by hand
 * (docs/memory/project-containers-not-received-20261021.md).
 *
 * The supplier files live in OneDrive, not on the server, so the browser
 * picks the containers and parses them (pickRecentContainers,
 * bestLinesFromSheets) and the server only classifies SKUs
 * (buildContainerReport). scripts/check-containers-vs-catalog.ts uses the
 * same functions. All pure.
 */

import { groupLinesBySku, parsePackingListSheet, type PackingListLine, type SheetRow } from './packing-list.ts'
import { containerRefFromFileName } from './receiving.ts'

// Per container, the Arrival List is preferred over the Original List; the
// Packing List workbook is an English letterhead format the parser can't read.
const KINDS = [/Arrival List/i, /Original List/i]

export interface PickedContainer {
  ref: string
  /** ETD as YYYY-MM-DD: the file-name prefix supplies the year. */
  etd: string
  /** File names to try, best kind first. */
  files: string[]
}

/**
 * The newest `count` containers among supplier file names such as
 * "2026-09 ETD 0914 976ctn Arrival List ... Cntr#TLLU5419845 ...", newest
 * first by year-month then ETD. Names that don't fit the pattern are ignored.
 */
export function pickRecentContainers(fileNames: string[], count: number): PickedContainer[] {
  const byRef = new Map<string, PickedContainer & { sortKey: string; kinds: Map<string, number> }>()
  for (const name of fileNames) {
    if (!/\.xlsx?$/i.test(name)) continue
    const kind = KINDS.findIndex((re) => re.test(name))
    const ref = containerRefFromFileName(name)
    const m = /^(\d{4}-\d{2}) ETD (\d{4})/.exec(name)
    if (kind < 0 || !ref || !m) continue
    const c = byRef.get(ref) ?? {
      ref,
      sortKey: `${m[1]}-${m[2]}`,
      etd: `${m[1].slice(0, 4)}-${m[2].slice(0, 2)}-${m[2].slice(2)}`,
      files: [],
      kinds: new Map(),
    }
    c.kinds.set(name, kind)
    byRef.set(ref, c)
  }
  return [...byRef.values()]
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey) || a.ref.localeCompare(b.ref))
    .slice(0, count)
    .map(({ ref, etd, kinds }) => ({
      ref,
      etd,
      files: [...kinds.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([n]) => n),
    }))
}

/**
 * The line items of a workbook: the tab that parses to the most SKUs, as
 * /admin/receiving would pick. Null lines with the last parse error when no
 * tab parses.
 */
export function bestLinesFromSheets(sheets: SheetRow[][]): { lines: PackingListLine[] | null; error: string | null } {
  let best: PackingListLine[] | null = null
  let error: string | null = null
  for (const rows of sheets) {
    try {
      const lines = groupLinesBySku(parsePackingListSheet(rows).lines)
      if (!best || lines.length > best.length) best = lines
    } catch (e) {
      error = (e as Error).message
    }
  }
  return best ? { lines: best, error: null } : { lines: null, error: error ?? 'no sheets' }
}

/** What the browser sends: one entry per picked container. */
export interface ContainerSkus {
  ref: string
  etd: string
  file: string | null
  error: string | null
  skus: { sku: string; pieces: number }[]
}

export interface CatalogSkuRow {
  sku: string | null
  is_active: boolean
  manually_hidden: boolean | null
}

export interface ShipmentRefRow {
  container_ref: string | null
  file_name: string
  status: string
}

export type Received = 'applied' | 'staged' | 'abandoned' | 'not staged'

export interface ContainerSummary {
  ref: string
  etd: string
  file: string | null
  error: string | null
  received: Received
  skus: number
  live: number
  hidden: number
  missing: number
  /** Missing from the catalog but present in Erply: the sync failing, not a receiving backlog. */
  inErplyNotCatalog: number
}

export interface MissingSku {
  sku: string
  /** Every picked container it ships on. */
  containers: string[]
  pieces: number
  /** Null when Erply wasn't checked. */
  inErply: boolean | null
}

export interface ContainerReport {
  containers: ContainerSummary[]
  /** On the most containers first: create those before staging any of them. */
  missing: MissingSku[]
  totals: { distinct: number; live: number; hidden: number; missing: number; inErplyNotCatalog: number }
  erplyChecked: boolean
}

const key = (sku: string) => sku.trim().toUpperCase()

/** SKUs the catalog doesn't have, upper-cased: the ones worth asking Erply about. */
export function missingSkuKeys(input: ContainerSkus[], catalog: CatalogSkuRow[]): string[] {
  const have = new Set(catalog.filter((c) => c.sku).map((c) => key(c.sku!)))
  return [...new Set(input.flatMap((c) => c.skus.map((s) => key(s.sku))))].filter((k) => !have.has(k)).sort()
}

export function buildContainerReport(
  input: ContainerSkus[],
  catalog: CatalogSkuRow[],
  shipments: ShipmentRefRow[],
  /** Upper-cased codes found in Erply, or null when Erply wasn't checked. */
  erplyCodes: Set<string> | null,
): ContainerReport {
  const bySku = new Map(catalog.filter((c) => c.sku).map((c) => [key(c.sku!), c]))
  const statusOf = (k: string) => {
    const p = bySku.get(k)
    return !p ? 'missing' : p.is_active && !p.manually_hidden ? 'live' : 'hidden'
  }

  // container_ref was null on the early shipments; the file name carries it.
  const RANK: Received[] = ['applied', 'staged', 'abandoned']
  const received = new Map<string, Received>()
  for (const s of shipments) {
    const ref = s.container_ref?.trim().toUpperCase() || containerRefFromFileName(s.file_name)
    const st = RANK.find((r) => r === s.status)
    if (!ref || !st) continue
    const prev = received.get(ref)
    if (!prev || RANK.indexOf(st) < RANK.indexOf(prev)) received.set(ref, st)
  }

  const missing = new Map<string, MissingSku>()
  const distinct = new Map<string, string>()
  const containers = input.map((c): ContainerSummary => {
    const keys = new Map<string, number>()
    for (const s of c.skus) keys.set(key(s.sku), (keys.get(key(s.sku)) ?? 0) + s.pieces)
    const counts = { live: 0, hidden: 0, missing: 0, inErplyNotCatalog: 0 }
    for (const [k, pieces] of keys) {
      const st = statusOf(k)
      distinct.set(k, st)
      counts[st]++
      if (st !== 'missing') continue
      const inErply = erplyCodes ? erplyCodes.has(k) : null
      if (inErply) counts.inErplyNotCatalog++
      const m = missing.get(k) ?? { sku: c.skus.find((s) => key(s.sku) === k)!.sku.trim(), containers: [], pieces: 0, inErply }
      if (!m.containers.includes(c.ref)) m.containers.push(c.ref)
      m.pieces += pieces
      missing.set(k, m)
    }
    return { ref: c.ref, etd: c.etd, file: c.file, error: c.error, received: received.get(c.ref.toUpperCase()) ?? 'not staged', skus: keys.size, ...counts }
  })

  const missingList = [...missing.values()].sort((a, b) => b.containers.length - a.containers.length || a.sku.localeCompare(b.sku))
  const n = (st: string) => [...distinct.values()].filter((v) => v === st).length
  return {
    containers,
    missing: missingList,
    totals: {
      distinct: distinct.size,
      live: n('live'),
      hidden: n('hidden'),
      missing: n('missing'),
      inErplyNotCatalog: missingList.filter((m) => m.inErply).length,
    },
    erplyChecked: erplyCodes !== null,
  }
}
