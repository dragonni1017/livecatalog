/**
 * Which product does this photo file belong to.
 *
 * One implementation, shared by the receiving screen's photo upload, the
 * uploader script and the gap finder. They must agree: a report saying a file
 * matches is worthless if the uploader then disagrees, and a screen that
 * uploads a file the finder never mentioned is worse.
 *
 * The rules exist because SKUs in this catalog end in digits and hyphens of
 * their own, so a trailing "-1" is genuinely ambiguous:
 *   P273814-45cm  is a product
 *   B325123-1     is a second angle of B325123
 *   S162815_2     is a second angle too -- suppliers write it both ways
 *   F288094 (2)   is Chrome downloading the same file twice
 * Exact SKU match therefore always wins, and only what is left over is
 * considered a view suffix.
 *
 * Deliberately free of `fs`: the browser hands the receiving screen File
 * objects, and a script hands it paths. Walking a directory lives in
 * scripts/photo-files.ts.
 */

export const IMAGE_RE = /\.(jpe?g|png|webp)$/i

/** Filename -> comparable stem, with Chrome's " (2)" marker stripped. */
export function stemOf(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)\s*$/, '').trim()
}

/** Was this file downloaded more than once? Used only as a tiebreak. */
export function isRedownload(fileName: string): boolean {
  return /\s*\(\d+\)\s*$/.test(fileName.replace(/\.[^.]+$/, ''))
}

/** The minimum a candidate file has to carry to be matched. */
export interface PhotoFile {
  name: string
  stem: string
  redownload: boolean
}

export interface PhotoMatch<F extends PhotoFile, P> {
  product: P
  primary: F | null
  views: { n: number; file: F }[]
  /** Same SKU and view, sent twice. Listed, never uploaded. */
  dupes: F[]
}

/** Build the shape matchFilesToProducts expects from a bare filename. */
export function toPhotoFile(name: string): PhotoFile {
  return { name, stem: stemOf(name), redownload: isRedownload(name) }
}

/**
 * Group files onto products.
 *
 * `bySku` maps UPPER-CASE sku -> product (anything with a `.sku`). Returns a
 * Map of sku -> match, plus the files that matched nothing.
 */
export function matchFilesToProducts<F extends PhotoFile, P extends { sku: string }>(
  files: F[],
  bySku: Map<string, P>,
): { plan: Map<string, PhotoMatch<F, P>>; unmatched: F[] } {
  const plan = new Map<string, PhotoMatch<F, P>>()
  const unmatched: F[] = []

  const entryFor = (product: P): PhotoMatch<F, P> =>
    plan.get(product.sku) ?? { product, primary: null, views: [], dupes: [] }

  for (const f of files) {
    const stem = f.stem.toUpperCase()

    const exact = bySku.get(stem)
    if (exact) {
      const entry = entryFor(exact)
      // Same SKU, no view number, twice = the same photo downloaded twice,
      // not two angles. The unmarked copy wins.
      if (!entry.primary) entry.primary = f
      else if (entry.primary.redownload && !f.redownload) { entry.dupes.push(entry.primary); entry.primary = f }
      else entry.dupes.push(f)
      plan.set(exact.sku, entry)
      continue
    }

    const m = /^(.*)[-_](\d+)$/.exec(stem)
    const base = m ? bySku.get(m[1]) : null
    if (base) {
      const entry = entryFor(base)
      const n = Number(m![2])
      const seen = entry.views.find((v) => v.n === n)
      if (!seen) entry.views.push({ n, file: f })
      else if (seen.file.redownload && !f.redownload) { entry.dupes.push(seen.file); seen.file = f }
      else entry.dupes.push(f)
      plan.set(base.sku, entry)
      continue
    }

    unmatched.push(f)
  }

  return { plan, unmatched }
}
