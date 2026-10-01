'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { IMAGE_RE, matchFilesToProducts, toPhotoFile, type PhotoFile, type PhotoMatch } from '@/lib/photo-matching'

// Folder / drag-drop photo upload for /admin/cleanup.
//
// Matching runs HERE, in the browser, with the same lib/photo-matching.ts the
// receiving screen and the photo scripts use, against every SKU in the
// catalog -- so the preview is exactly what will be uploaded.
//
// Upload goes browser -> Cloudinary DIRECTLY, signed per public id by
// /admin/api/cleanup/photo-signature. The bytes never pass through a Vercel
// function: a function body is capped at 4.5 MB, and one phone photo can be
// half of that. Only the resulting URLs are sent to /admin/api/cleanup/photos.
//
// Stored URLs are Cloudinary's raw secure_url -- no transformation is ever
// added here; every width is applied at render time by lib/image.ts
// (docs/memory/project-image-sizing-contract.md). Originals are uploaded as
// they are, not compressed first.
//
// Catalog-only: nothing here writes to Erply or WooCommerce.

interface Product {
  sku: string
  hasImage: boolean
}

type DropFile = PhotoFile & { file: File; key: string }
type Entry = PhotoMatch<DropFile, Product>

interface Signed {
  cloudName: string
  apiKey: string
  timestamp: number
  signatures: Record<string, string>
}

interface Outcome {
  updated: number
  skipped: string[]
  failures: string[]
}

// Products per signature + save round trip. Small so that a signature is
// always fresh (Cloudinary rejects one older than an hour) and so progress is
// saved as it goes rather than all at the end.
const BATCH_PRODUCTS = 20
const UPLOAD_CONCURRENCY = 4
const LIST_LIMIT = 200

function uploadsFor(entry: Entry): { publicId: string; file: File }[] {
  const sku = entry.product.sku
  return [
    ...(entry.primary ? [{ publicId: sku, file: entry.primary.file }] : []),
    ...[...entry.views].sort((a, b) => a.n - b.n).map((v) => ({ publicId: `${sku}-${v.n}`, file: v.file.file })),
  ]
}

async function readAllDirectory(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader()
  const out: FileSystemEntry[] = []
  // readEntries returns at most ~100 entries per call; keep reading until empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) break
    out.push(...batch)
  }
  return out
}

async function filesFromEntry(entry: FileSystemEntry, path: string): Promise<{ file: File; path: string }[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    return [{ file, path: `${path}${file.name}` }]
  }
  if (entry.isDirectory) {
    const children = await readAllDirectory(entry as FileSystemDirectoryEntry)
    const nested = await Promise.all(children.map((c) => filesFromEntry(c, `${path}${entry.name}/`)))
    return nested.flat()
  }
  return []
}

async function uploadOne(signed: Signed, publicId: string, file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', signed.apiKey)
  form.append('timestamp', String(signed.timestamp))
  form.append('public_id', publicId)
  form.append('signature', signed.signatures[publicId])
  const res = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  })
  let json: { secure_url?: string; error?: { message?: string } } | null = null
  try {
    json = await res.json()
  } catch {
    // fall through to the status below
  }
  if (!res.ok || !json?.secure_url) {
    throw new Error(json?.error?.message || `Cloudinary returned ${res.status}`)
  }
  return json.secure_url
}

/** Runs `tasks` with at most `limit` in flight, preserving result order. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

export default function CleanupPhotoDrop({ products }: { products: Product[] }) {
  const router = useRouter()
  const [files, setFiles] = useState<DropFile[]>([])
  const [ignored, setIgnored] = useState(0)
  const [replace, setReplace] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  const bySku = useMemo(() => new Map(products.map((p) => [p.sku.trim().toUpperCase(), p])), [products])

  const { entries, unmatched } = useMemo(() => {
    const { plan, unmatched } = matchFilesToProducts(files, bySku)
    const entries = [...plan.values()].sort((a, b) => a.product.sku.localeCompare(b.product.sku))
    return { entries, unmatched }
  }, [files, bySku])

  const fresh = entries.filter((e) => !e.product.hasImage)
  const haveImage = entries.filter((e) => e.product.hasImage)
  const dupes = entries.flatMap((e) => e.dupes.map((d) => ({ sku: e.product.sku, name: d.name })))
  const todo = replace ? entries : fresh
  const todoFileCount = todo.reduce((n, e) => n + uploadsFor(e).length, 0)

  function accept(list: { file: File; path: string }[]) {
    const images = list.filter((f) => IMAGE_RE.test(f.file.name))
    setIgnored(list.length - images.length)
    setFiles(images.map((f) => ({ ...toPhotoFile(f.file.name), file: f.file, key: f.path })))
    setOutcome(null)
    setError(null)
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    // Entries must be taken synchronously: DataTransfer items are emptied
    // once the event handler yields.
    const roots = [...e.dataTransfer.items]
      .map((item) => (item.kind === 'file' ? item.webkitGetAsEntry() : null))
      .filter((x): x is FileSystemEntry => x !== null)
    if (roots.length === 0) {
      accept([...e.dataTransfer.files].map((file) => ({ file, path: file.name })))
      return
    }
    try {
      const nested = await Promise.all(roots.map((r) => filesFromEntry(r, '')))
      accept(nested.flat())
    } catch {
      setError('Could not read the dropped folder. Try the "Choose folder" button instead.')
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = [...(e.target.files ?? [])].map((file) => ({
      file,
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }))
    accept(list)
    e.target.value = ''
  }

  async function upload() {
    if (todo.length === 0) return
    setBusy(true)
    setError(null)
    setOutcome(null)
    const total: Outcome = { updated: 0, skipped: [], failures: [] }
    setProgress({ done: 0, total: todo.length })

    try {
      for (let i = 0; i < todo.length; i += BATCH_PRODUCTS) {
        const batch = todo.slice(i, i + BATCH_PRODUCTS)
        const plan = batch.map((entry) => ({ entry, uploads: uploadsFor(entry) }))

        const sigRes = await fetch('/admin/api/cleanup/photo-signature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicIds: plan.flatMap((p) => p.uploads.map((u) => u.publicId)) }),
        })
        const sigErr = await readApiError(sigRes, 'Could not get an upload signature.')
        if (sigErr) {
          // A signing failure is not per-product; stop rather than repeat it.
          total.failures.push(sigErr)
          break
        }
        const signed = (await sigRes.json()) as Signed

        const flat = plan.flatMap((p, pi) => p.uploads.map((u) => ({ pi, ...u })))
        const settled = await pool(
          flat.map((u) => () => uploadOne(signed, u.publicId, u.file)),
          UPLOAD_CONCURRENCY,
        )

        // A product is saved only if every one of its files uploaded, so a
        // half-uploaded set never becomes its gallery. (Anything that did
        // upload stays in Cloudinary under the same id and is simply
        // overwritten on a retry.)
        const items: { sku: string; urls: string[] }[] = []
        plan.forEach((p, pi) => {
          const mine = flat.map((u, fi) => ({ u, r: settled[fi] })).filter((x) => x.u.pi === pi)
          const failed = mine.find((x) => x.r.status === 'rejected')
          if (failed) {
            const reason = (failed.r as PromiseRejectedResult).reason
            total.failures.push(
              `${p.entry.product.sku}: ${failed.u.file.name} — ${reason instanceof Error ? reason.message : String(reason)}`,
            )
            return
          }
          items.push({
            sku: p.entry.product.sku,
            urls: mine.map((x) => (x.r as PromiseFulfilledResult<string>).value),
          })
        })

        if (items.length > 0) {
          const saveRes = await fetch('/admin/api/cleanup/photos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, replace }),
          })
          const saveErr = await readApiError(saveRes, 'Uploaded, but saving to the catalog failed.')
          if (saveErr) {
            total.failures.push(`${items.map((it) => it.sku).join(', ')}: ${saveErr}`)
          } else {
            const json = (await saveRes.json()) as Outcome
            total.updated += json.updated
            total.skipped.push(...json.skipped)
            total.failures.push(...json.failures)
          }
        }

        setProgress({ done: Math.min(i + BATCH_PRODUCTS, todo.length), total: todo.length })
      }
    } catch {
      total.failures.push(TRANSPORT_ERROR)
    } finally {
      setOutcome(total)
      setBusy(false)
      setProgress(null)
      if (total.updated > 0) router.refresh()
    }
  }

  const directoryProps = { webkitdirectory: '', directory: '' } as Record<string, string>

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">Add photos</h2>
      <p className="mt-1 text-sm text-gray-500">
        Drop a folder of photos named by SKU (<code>F288094.jpg</code>, extra angles as <code>F288094-2.jpg</code>).
        They are matched against every SKU in the catalog, uploaded to Cloudinary as originals, and shown on the
        catalog only — nothing is sent to Erply or WooCommerce.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-4 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-sm ${
          dragging ? 'border-gray-900 bg-gray-50' : 'border-gray-300'
        }`}
      >
        <span className="text-gray-600">Drag a folder or photos here</span>
        <div className="flex gap-2">
          <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            Choose folder
            <input type="file" multiple className="hidden" onChange={onPick} {...directoryProps} />
          </label>
          <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            Choose files
            <input type="file" multiple accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={onPick} />
          </label>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {files.length > 0 && (
        <div className="mt-5 space-y-4 text-sm">
          <p className="text-gray-700">
            {files.length.toLocaleString()} photo{files.length === 1 ? '' : 's'} read
            {ignored > 0 && <span className="text-gray-400"> ({ignored} non-image file{ignored === 1 ? '' : 's'} ignored)</span>}:{' '}
            <strong>{fresh.length}</strong> product{fresh.length === 1 ? '' : 's'} without a photo matched,{' '}
            <strong>{haveImage.length}</strong> already have one, <strong>{dupes.length}</strong> duplicate
            {dupes.length === 1 ? '' : 's'}, <strong>{unmatched.length}</strong> unmatched.
          </p>

          {fresh.length > 0 && (
            <MatchList title="Will be added" entries={fresh} />
          )}

          {haveImage.length > 0 && (
            <div>
              <label className="flex items-center gap-2 text-gray-700">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Also replace the existing photo on these {haveImage.length} product{haveImage.length === 1 ? '' : 's'}
              </label>
              <MatchList
                title={replace ? 'Will be replaced' : 'Already have a photo — left alone'}
                entries={haveImage}
                muted={!replace}
              />
            </div>
          )}

          {dupes.length > 0 && (
            <SimpleList
              title="Duplicates — same SKU and angle sent twice, never uploaded"
              items={dupes.map((d) => `${d.name} (${d.sku})`)}
            />
          )}

          {unmatched.length > 0 && (
            <SimpleList title="Unmatched — no product has this SKU" items={unmatched.map((f) => f.key)} />
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={upload}
              disabled={busy || todo.length === 0}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {busy
                ? 'Uploading…'
                : `Upload ${todoFileCount} photo${todoFileCount === 1 ? '' : 's'} for ${todo.length} product${todo.length === 1 ? '' : 's'}`}
            </button>
            {progress && (
              <span className="text-gray-500">
                {progress.done} of {progress.total} products done
              </span>
            )}
          </div>
        </div>
      )}

      {outcome && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
          <p className="text-gray-800">
            {outcome.updated} product{outcome.updated === 1 ? '' : 's'} updated.
            {outcome.skipped.length > 0 && ` ${outcome.skipped.length} skipped because they now have a photo.`}
          </p>
          {outcome.skipped.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">Skipped: {outcome.skipped.join(', ')}</p>
          )}
          {outcome.failures.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-red-600">
              {outcome.failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function MatchList({ title, entries, muted = false }: { title: string; entries: Entry[]; muted?: boolean }) {
  return (
    <details className="mt-2" open={!muted && entries.length <= 20}>
      <summary className={`cursor-pointer ${muted ? 'text-gray-400' : 'text-gray-700'}`}>
        {title} ({entries.length})
      </summary>
      <ul className={`mt-2 max-h-64 overflow-y-auto pl-4 text-xs ${muted ? 'text-gray-400' : 'text-gray-600'}`}>
        {entries.slice(0, LIST_LIMIT).map((e) => (
          <li key={e.product.sku}>
            <span className="font-mono">{e.product.sku}</span>
            {' — '}
            {e.primary ? e.primary.name : <em>no primary photo (first angle becomes the main image)</em>}
            {e.views.length > 0 && (
              <span>
                {' '}+ {e.views.length} angle{e.views.length === 1 ? '' : 's'} (
                {[...e.views].sort((a, b) => a.n - b.n).map((v) => `-${v.n}`).join(', ')})
              </span>
            )}
          </li>
        ))}
        {entries.length > LIST_LIMIT && <li>… and {entries.length - LIST_LIMIT} more</li>}
      </ul>
    </details>
  )
}

function SimpleList({ title, items }: { title: string; items: string[] }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-gray-700">
        {title} ({items.length})
      </summary>
      <ul className="mt-2 max-h-48 overflow-y-auto pl-4 text-xs text-gray-500">
        {items.slice(0, LIST_LIMIT).map((item, i) => (
          <li key={i} className="font-mono">
            {item}
          </li>
        ))}
        {items.length > LIST_LIMIT && <li>… and {items.length - LIST_LIMIT} more</li>}
      </ul>
    </details>
  )
}
