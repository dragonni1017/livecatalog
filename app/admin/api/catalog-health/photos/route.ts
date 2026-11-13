import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { classifyPhoto } from '@/lib/catalog-health'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET /admin/api/catalog-health/photos: asks the image host for every visible
// product's main photo (HEAD only) and returns the ones that don't load or are
// thumbnail-sized. On demand from /admin/catalog-health, since ~1,100 requests
// is too slow for every page load. Read-only. Under /admin, so middleware.ts
// requires the admin login.

const CONCURRENCY = 16

export async function GET() {
  try {
    const db = getAdminClient()
    const products: { id: string; sku: string; name: string; image_url: string | null }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('products')
        .select('id, sku, name, image_url')
        .eq('is_active', true)
        .eq('manually_hidden', false)
        .not('image_url', 'is', null)
        .order('sku')
        .range(from, from + 999)
      if (error) throw error
      products.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }

    const bad: { id: string; sku: string; name: string; verdict: 'broken' | 'tiny'; detail: string }[] = []
    let next = 0
    async function worker() {
      while (next < products.length) {
        const p = products[next++]
        const url = p.image_url!.trim()
        let verdict, detail
        try {
          const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15_000) })
          const bytes = Number(r.headers.get('content-length') ?? 0) || 0
          verdict = classifyPhoto({ ok: r.ok, status: r.status, contentType: r.headers.get('content-type') ?? '', bytes })
          detail = verdict === 'tiny' ? `${bytes} bytes, thumbnail-sized` : `HTTP ${r.status}`
        } catch (e) {
          verdict = 'broken' as const
          detail = e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : 'did not load'
        }
        if (verdict !== 'ok') bad.push({ id: p.id, sku: p.sku, name: p.name, verdict, detail })
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    bad.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.sku.localeCompare(b.sku))
    return NextResponse.json({ checked: products.length, bad })
  } catch (err) {
    console.error('[admin/catalog-health/photos] error:', err)
    return NextResponse.json({ error: 'Photo check failed' }, { status: 500 })
  }
}
