'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  id: string
  name: string
}

export default function ProductDeleteButton({ id, name }: Props) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (
      !confirm(
        `Permanently delete "${name}"?\n\nThis removes it everywhere on the site. If it still exists in Erply or the next Excel import, it will just come back on the next sync.`,
      )
    ) {
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/admin/api/products?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Delete failed')
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
      setDeleting(false)
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="rounded-md border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
    >
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  )
}
