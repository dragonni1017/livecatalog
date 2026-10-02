import type { Product } from '@/lib/types'
import type { DisplaySettings } from '@/lib/display-settings'
import { resolveCdnImage } from '@/lib/image'
import { stripCsSuffix } from '@/lib/pack'

// schema.org Product + Offer for the product page, so search engines can
// show name, image, price and availability as a rich result.
//
// Mirrors the page exactly: a field is included only when the page shows it
// (display_settings), so structured data never reveals something a visitor
// can't see. Google treats a mismatch between markup and page as spam.

const SITE = 'https://lyusa.app'
const SELLER = { '@type': 'Organization', name: 'L & Y USA', url: SITE } as const

/**
 * A barcode as a schema.org GTIN, or null. Only all-digit values of a GTIN
 * length (8, 12, 13, 14) qualify. The check digit is deliberately NOT
 * validated: barcode length and format vary by setup era on this account,
 * and a "failing" one isn't damaged data
 * (docs/memory/feedback-barcode-length-not-truncation.md). Anything else is
 * left out rather than guessed at.
 */
export function gtinFor(barcode: string | null | undefined): string | null {
  const b = barcode?.trim() ?? ''
  return /^\d+$/.test(b) && [8, 12, 13, 14].includes(b.length) ? b : null
}

type Settings = Pick<DisplaySettings, 'show_price_detail' | 'show_stock_detail' | 'show_sku_barcode_detail' | 'show_category_detail'>

export function productJsonLd(product: Product, settings: Settings): Record<string, unknown> {
  const url = `${SITE}/product/${encodeURIComponent(product.id)}`
  const images = [product.image_url, ...(product.image_urls ?? [])]
    .map((u) => resolveCdnImage(u ?? null, 1200))
    .filter((u, i, all): u is string => !!u && all.indexOf(u) === i)
  const description = stripCsSuffix(product.description)?.trim()

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: stripCsSuffix(product.name),
    url,
    ...(images.length ? { image: images } : {}),
    ...(description ? { description } : {}),
    ...(settings.show_category_detail && product.category?.name ? { category: product.category.name } : {}),
  }

  if (settings.show_sku_barcode_detail) {
    ld.sku = product.sku
    const gtin = gtinFor(product.barcode)
    if (gtin) ld.gtin = gtin
  }

  // An Offer needs a price. Without one (hidden by settings, or a $0
  // product awaiting pricing) there's no Offer at all, rather than a
  // misleading "$0.00".
  if (settings.show_price_detail && product.price_cents > 0) {
    const availability = !product.is_active
      ? 'https://schema.org/Discontinued'
      : settings.show_stock_detail
        ? product.stock_qty > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock'
        : undefined
    ld.offers = {
      '@type': 'Offer',
      url,
      price: (product.price_cents / 100).toFixed(2),
      priceCurrency: 'USD',
      itemCondition: 'https://schema.org/NewCondition',
      ...(availability ? { availability } : {}),
      seller: SELLER,
    }
  }

  return ld
}

/**
 * JSON for a <script type="application/ld+json"> tag. `<` is escaped so a
 * product name or description containing `</script>` can't close the tag
 * and inject markup.
 */
export function jsonLdScript(ld: Record<string, unknown>): string {
  return JSON.stringify(ld).replace(/</g, '\\u003c')
}
