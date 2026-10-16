import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { resolveCdnImage } from '@/lib/image'
import PrintButton from '@/components/admin/PrintButton'
import type { Category } from '@/lib/types'
import { MAX_LINE_CARD_SKUS as MAX_SKUS, parseSkuList, splitPackSpec } from '@/lib/line-card'
import { applyTierDiscount } from '@/lib/order-rules'
import { loadPriceOptions, resolvePriceScope } from '@/lib/price-scope'
import { productUrl, qrPath } from '@/lib/qr'
import { loadCollectionProductIds } from '@/lib/collections'

// Printable product line card: a photo grid for reps and trade shows, saved
// with the browser's "Save as PDF" like /admin/price-list. Shared by
// /admin/line-card and /rep/line-card; middleware gates both paths, so this
// reads with the server client and needs no API route.
//
// Everything comes from GET params, so a configured card is a shareable URL:
//   cat=<slug> (repeatable) · skus=<list> · hideprices=1 · instock=1 · cols=3|4 · title=<text>
//   price=tier:<code>|customer:<uuid> · qr=1 (QR code per card → its product page)
//   collection=<slug> (its products in order; used when no skus are pasted)

export type LineCardParams = Record<string, string | string[] | undefined>

const PAGE = 1000 // PostgREST's default max rows per request
const IMAGE_WIDTH = 400 // ~2x a 4-across card at print size

interface CardProduct {
  id: string
  sku: string
  name: string
  price_cents: number
  stock_qty: number
  image_url: string | null
  image_urls: string[] | null
  category_id: string | null
}

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

function all(v: string | string[] | undefined): string[] {
  return Array.isArray(v) ? v : v ? [v] : []
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** Scannable link to the product page; ~0.5in square when printed. */
function ProductQr({ productId }: { productId: string }) {
  const url = productUrl(productId)
  const { size, d } = qrPath(url)
  return (
    <svg
      viewBox={`-1 -1 ${size + 2} ${size + 2}`}
      className="h-12 w-12 shrink-0"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code: ${url}`}
      data-qr-url={url}
    >
      <rect x="-1" y="-1" width={size + 2} height={size + 2} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}

const SELECT = 'id, sku, name, price_cents, stock_qty, image_url, image_urls, category_id'

async function loadProducts(categoryIds: string[], skus: string[], inStockOnly: boolean): Promise<CardProduct[]> {
  const db = getAdminClient()
  const base = () => {
    // Only what a customer could see and order: active, not hidden, priced.
    // A visible $0 product is orderable, so it never belongs on a handout.
    let q = db
      .from('products')
      .select(SELECT)
      .eq('is_active', true)
      .eq('manually_hidden', false)
      .gt('price_cents', 0)
    if (inStockOnly) q = q.gt('stock_qty', 0)
    return q
  }

  const rows: CardProduct[] = []
  if (skus.length > 0) {
    // Chunked so the IN list stays well under URL limits.
    for (let i = 0; i < skus.length; i += 100) {
      const { data } = await base().in('sku', skus.slice(i, i + 100))
      rows.push(...((data ?? []) as CardProduct[]))
    }
    return rows
  }
  if (categoryIds.length === 0) return rows
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await base().in('category_id', categoryIds).order('name').range(from, from + PAGE - 1)
    if (error) break
    rows.push(...((data ?? []) as CardProduct[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

export default async function LineCard({
  params,
  basePath,
  backHref,
  backLabel,
}: {
  params: LineCardParams
  basePath: string
  backHref: string
  backLabel: string
}) {
  const db = getAdminClient()
  const { data: catData } = await db.from('categories').select('*').order('display_order')
  const categories = (catData ?? []) as Category[]

  const catSlugs = all(params.cat)
  const chosenCats = categories.filter((c) => catSlugs.includes(c.slug))
  const skuRaw = first(params.skus)
  const pastedSkus = parseSkuList(skuRaw)

  // A collection (lib/collections.ts) is just an ordered SKU list here, so SKU
  // mode does the rest. Any status: printing an upcoming season ahead is fine.
  const collectionSlug = first(params.collection)
  const { data: allCollections } = await db.from('collections').select('id, slug, name').order('display_order').order('name')
  const collection = !pastedSkus.length ? ((allCollections ?? []) as { id: string; slug: string; name: string }[]).find((c) => c.slug === collectionSlug) ?? null : null
  let skus = pastedSkus
  if (collection) {
    const ids = await loadCollectionProductIds(db, collection.id)
    const { data: rows } = ids.length ? await db.from('products').select('id, sku').in('id', ids) : { data: [] }
    const skuById = new Map(((rows ?? []) as { id: string; sku: string }[]).map((r) => [r.id, r.sku]))
    skus = ids.map((id) => skuById.get(id)).filter((s): s is string => !!s)
  }
  const hidePrices = first(params.hideprices) === '1'
  const inStockOnly = first(params.instock) === '1'
  const showQr = first(params.qr) === '1'
  const cols = first(params.cols) === '3' ? 3 : 4
  const title = first(params.title).trim().slice(0, 80) || 'Wholesale Line Card'

  const priceParam = first(params.price)
  const [products, priceScope, priceOptions] = await Promise.all([
    loadProducts(chosenCats.map((c) => c.id), skus, inStockOnly),
    resolvePriceScope(db, priceParam),
    loadPriceOptions(db),
  ])
  // Same per-unit math as an order (applyTierDiscount, quarter-rounded).
  const unitPrice = (cents: number) => applyTierDiscount(cents, priceScope.discountPct)
  const notFound = skus.length > 0
    ? skus.filter((s) => !products.some((p) => p.sku.toUpperCase() === s.toUpperCase()))
    : []

  // SKU mode keeps the pasted order as one group; category mode groups by
  // category in the catalog's display order.
  let groups: { name: string | null; items: CardProduct[] }[]
  if (skus.length > 0) {
    const bySku = new Map(products.map((p) => [p.sku.toUpperCase(), p]))
    groups = [{ name: collection?.name ?? null, items: skus.map((s) => bySku.get(s.toUpperCase())).filter((p): p is CardProduct => !!p) }]
  } else {
    groups = chosenCats
      .map((c) => ({ name: c.name, items: products.filter((p) => p.category_id === c.id) }))
      .filter((g) => g.items.length > 0)
  }
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const hasSelection = chosenCats.length > 0 || skus.length > 0 || !!collection
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="mx-auto max-w-5xl bg-white p-8 text-gray-900 print:max-w-none print:p-0">
      {/* Margins for the saved PDF; the browser's own headers/footers are a print-dialog setting. */}
      <style>{`@page { size: letter; margin: 0.4in; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>

      {/* Builder — never printed */}
      <div className="mb-8 rounded-xl border border-gray-200 bg-gray-50 p-5 print:hidden">
        <div className="mb-4 flex items-center justify-between">
          <Link href={backHref} className="text-sm text-gray-500 hover:text-gray-700">
            {backLabel}
          </Link>
          {total > 0 && <PrintButton />}
        </div>
        <form action={basePath} method="get" className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Categories</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4">
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" name="cat" value={c.slug} defaultChecked={catSlugs.includes(c.slug)} className="h-4 w-4 rounded border-gray-300 text-red-600" />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="lc-skus" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Or paste SKUs <span className="font-normal normal-case text-gray-400">(overrides categories; keeps your order; up to {MAX_SKUS})</span>
            </label>
            <textarea id="lc-skus" name="skus" rows={2} defaultValue={skuRaw} className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm" placeholder="F287957, F287984, D751067" />
          </div>
          {(allCollections ?? []).length > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Or a collection</span>
              <select name="collection" defaultValue={collection?.slug ?? ''} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
                <option value="">—</option>
                {((allCollections ?? []) as { slug: string; name: string }[]).map((c) => (
                  <option key={c.slug} value={c.slug}>{c.name}</option>
                ))}
              </select>
              <span className="text-xs text-gray-400">(used when no SKUs are pasted)</span>
            </label>
          )}
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[16rem] flex-1">
              <label htmlFor="lc-title" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Title</label>
              <input id="lc-title" name="title" maxLength={80} defaultValue={first(params.title)} placeholder="Wholesale Line Card" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              Prices at
              <select name="price" defaultValue={priceParam} className="max-w-[18rem] rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
                <option value="">Catalog price</option>
                {priceOptions.tiers.length > 0 && (
                  <optgroup label="Price tier">
                    {priceOptions.tiers.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                )}
                {priceOptions.customers.length > 0 && (
                  <optgroup label="Customer">
                    {priceOptions.customers.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="hideprices" value="1" defaultChecked={hidePrices} className="h-4 w-4 rounded border-gray-300 text-red-600" />
              Hide prices
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="instock" value="1" defaultChecked={inStockOnly} className="h-4 w-4 rounded border-gray-300 text-red-600" />
              In stock only
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="qr" value="1" defaultChecked={showQr} className="h-4 w-4 rounded border-gray-300 text-red-600" />
              QR codes
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              Per row
              <select name="cols" defaultValue={String(cols)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
                <option value="4">4</option>
                <option value="3">3</option>
              </select>
            </label>
            <button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700">
              Build line card
            </button>
          </div>
        </form>
        {hasSelection && (
          <p className="mt-3 text-xs text-gray-500">
            {total} product{total === 1 ? '' : 's'}. Only visible, priced products are included
            {inStockOnly ? ', in stock only' : ''}. In the print dialog choose &quot;Save as PDF&quot;
            and turn off &quot;Headers and footers&quot; for a clean file.
            {notFound.length > 0 && (
              <span className="block text-amber-700">
                Not included ({notFound.length}): {notFound.slice(0, 30).join(', ')}
                {notFound.length > 30 ? '…' : ''}. These are unknown, hidden, unpriced{inStockOnly ? ' or out of stock' : ''}.
              </span>
            )}
          </p>
        )}
      </div>

      {!hasSelection ? (
        <p className="text-sm text-gray-500 print:hidden">Choose one or more categories, or paste SKUs, then Build line card.</p>
      ) : total === 0 ? (
        <p className="text-sm text-gray-500">No visible, priced products match.</p>
      ) : (
        <>
          <header className="mb-4 flex items-end justify-between border-b-2 border-gray-900 pb-2">
            <div>
              <h1 className="text-xl font-bold">L &amp; Y USA — {title}</h1>
              <p className="text-xs text-gray-600">626-552-4120 · www.ly-usa.com · {today}</p>
            </div>
            <p className="text-right text-xs text-gray-500">
              {total} items
              {!hidePrices && (
                <>
                  <br />
                  {priceScope.label ? `Prices for ${priceScope.label}` : 'Catalog prices'} · per unit, subject to change
                </>
              )}
            </p>
          </header>

          {groups.map((g, gi) => (
            <section key={g.name ?? 'skus'} className={gi > 0 ? 'mt-6 print:break-before-page' : ''}>
              {g.name && (
                <h2 className="mb-2 border-b border-gray-300 pb-1 text-sm font-bold uppercase tracking-wide text-gray-700">{g.name}</h2>
              )}
              <div className={`grid gap-3 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                {g.items.map((p) => {
                  const { title: pTitle, spec } = splitPackSpec(p.name)
                  const img = resolveCdnImage(p.image_url ?? p.image_urls?.[0] ?? null, IMAGE_WIDTH)
                  return (
                    <div key={p.id} className="flex break-inside-avoid flex-col rounded-md border border-gray-200 p-2">
                      <div className="mb-2 flex aspect-square items-center justify-center overflow-hidden bg-white">
                        {img ? (
                          // Plain <img>, eager: next/image lazy-loads, and a lazy image
                          // that hasn't loaded prints as a blank box in the PDF.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img} alt="" loading="eager" decoding="sync" className="max-h-full max-w-full object-contain" />
                        ) : (
                          <span className="text-xs text-gray-300">No photo</span>
                        )}
                      </div>
                      <p className="line-clamp-2 text-xs font-semibold leading-snug">{pTitle}</p>
                      {spec && <p className="mt-0.5 text-[10px] leading-snug text-gray-500">{spec}</p>}
                      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                        <div className={showQr ? 'flex flex-col' : 'contents'}>
                          <span className="font-mono text-[10px] text-gray-500">{p.sku}</span>
                          {!hidePrices && <span className="text-sm font-bold">{formatPrice(unitPrice(p.price_cents))}</span>}
                        </div>
                        {showQr && <ProductQr productId={p.id} />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
