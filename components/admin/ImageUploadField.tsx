'use client'

import { useRef, useState } from 'react'
import { getAuthClient } from '@/lib/auth-client'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

interface Props {
  onUploaded: (url: string) => void
  label?: string
}

// Lets admin attach an image file directly instead of only pasting an
// already-hosted URL -- product photos are added quickly and often on the
// spot, and not every photo has a URL ready to paste. Uploads go straight
// from the browser to Supabase Storage via a signed URL (see
// app/admin/api/products/upload-image), not through this Next.js route --
// full-res product photos run several MB, over what Vercel serverless
// functions allow as a request body.
export default function ImageUploadField({ onUploaded, label = 'Attach file' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    try {
      const prepRes = await fetch('/admin/api/products/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      })
      const prep = await prepRes.json()
      if (!prepRes.ok || prep.error) throw new Error(prep.error || 'Could not prepare upload')

      const { error: uploadError } = await getAuthClient()
        .storage.from('product-images')
        .uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type })
      if (uploadError) throw uploadError

      onUploaded(prep.publicUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
      >
        {uploading ? 'Uploading…' : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
