// photo-files.ts
//
// Walking a directory for image files. Separate from lib/photo-matching.ts so
// that module stays free of `fs` and can be imported by a server route, where
// the files arrive from the browser rather than from disk.

import fs from 'fs'
import path from 'path'
import { IMAGE_RE, isRedownload, stemOf, type PhotoFile } from '../lib/photo-matching.ts'

export interface LocalPhotoFile extends PhotoFile {
  dir: string
  filePath: string
}

/**
 * Image files in `dirs`. With `recursive`, walks subdirectories too, skipping
 * anything in `skipDirs` (matched on the directory's own name).
 */
export function readImageFiles(
  dirs: string[],
  { recursive = false, skipDirs = [] }: { recursive?: boolean; skipDirs?: string[] } = {},
): LocalPhotoFile[] {
  const out: LocalPhotoFile[] = []
  const skip = new Set(skipDirs.map((s) => s.toLowerCase()))
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // an unreadable directory is not worth failing a report over
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
