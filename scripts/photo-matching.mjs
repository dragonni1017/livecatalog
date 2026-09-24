// photo-matching.mjs
//
// One implementation of "which product does this photo file belong to",
// shared by the finder (find-photos-for-missing-images.mjs) and the uploader
// (upload-container-photos.mjs). They must agree: a report saying a file
// matches is worthless if the uploader then disagrees.
//
// The rules exist because SKUs in this catalog end in digits and hyphens of
// their own, so a trailing "-1" is genuinely ambiguous:
//   P273814-45cm  is a product
//   B325123-1     is a second angle of B325123
//   S162815_2     is a second angle too -- suppliers write it both ways
//   F288094 (2)   is Chrome downloading the same file twice
// Exact SKU match therefore always wins, and only what is left over is
// considered a view suffix.

import fs from 'fs'
import path from 'path'

export const IMAGE_RE = /\.(jpe?g|png|webp)$/i

/** Filename -> comparable stem, with Chrome's " (2)" marker stripped. */
export function stemOf(fileName) {
  return fileName.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)\s*$/, '').trim()
}

/** Was this file downloaded more than once? Used only as a tiebreak. */
export function isRedownload(fileName) {
  return /\s*\(\d+\)\s*$/.test(fileName.replace(/\.[^.]+$/, ''))
}

/**
 * Image files in `dirs`. With `recursive`, walks subdirectories too, skipping
 * anything in `skipDirs` (matched on the directory's own name).
 */
export function readImageFiles(dirs, { recursive = false, skipDirs = [] } = {}) {
  const out = []
  const skip = new Set(skipDirs.map((s) => s.toLowerCase()))
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory is not worth failing a report over
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (recursive && !skip.has(e.name.toLowerCase()) && !e.name.startsWith('.')) walk(full)
        continue
      }
      if (!IMAGE_RE.test(e.name)) continue
      out.push({ dir, name: e.name, stem: stemOf(e.name), redownload: isRedownload(e.name), filePath: full })
    }
  }
  for (const d of dirs) walk(d)
  return out
}

/**
 * Group files onto products.
 *
 * `bySku` maps UPPER-CASE sku -> product (anything with a `.sku`). Returns a
 * Map of sku -> { product, primary, views: [{n, file}], dupes: [] } plus the
 * files that matched nothing.
 */
export function matchFilesToProducts(files, bySku) {
  const plan = new Map()
  const unmatched = []

  const entryFor = (product) =>
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
      const n = Number(m[2])
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
