import { describe, expect, it } from 'vitest'
import type { Product } from '../lib/types'
import { gtinFor, jsonLdScript, productJsonLd } from '../lib/product-jsonld'

const ALL_ON = { show_price_detail: true, show_stock_detail: true, show_sku_barcode_detail: true, show_category_detail: true }

const product = (over: Partial<Product> = {}): Product =>
  ({
    id: 'prod-00042',
    sku: 'F284020',
    name: 'Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120',
    description: 'Soft foam bear.',
    price_cents: 1250,
    stock_qty: 30,
    barcode: '737879106143',
    image_url: 'https://res.cloudinary.com/x/image/upload/F284020.jpg',
    image_urls: [],
    is_active: true,
    manually_hidden: false,
    category: { id: 'c1', name: 'Plush', slug: 'plush' },
    ...over,
  }) as unknown as Product

describe('gtinFor', () => {
  it('accepts all-digit GTIN lengths without judging the check digit', () => {
    expect(gtinFor('737879106143')).toBe('737879106143')
    expect(gtinFor('12345678')).toBe('12345678')
    expect(gtinFor('1234567890128')).toBe('1234567890128')
  })
  it('leaves out anything that is not a GTIN shape', () => {
    expect(gtinFor('12345')).toBeNull()
    expect(gtinFor('ABC123456789')).toBeNull()
    expect(gtinFor('7378 7910 6143')).toBeNull()
    expect(gtinFor(null)).toBeNull()
  })
})

describe('productJsonLd', () => {
  it('builds a Product with an in-stock USD Offer', () => {
    const ld = productJsonLd(product(), ALL_ON)
    expect(ld['@type']).toBe('Product')
    expect(ld.sku).toBe('F284020')
    expect(ld.gtin).toBe('737879106143')
    expect(ld.category).toBe('Plush')
    expect(ld.url).toBe('https://lyusa.app/product/prod-00042')
    expect(ld.offers).toMatchObject({
      '@type': 'Offer',
      price: '12.50',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    })
  })

  it('marks zero stock out of stock, and an inactive product discontinued', () => {
    expect((productJsonLd(product({ stock_qty: 0 }), ALL_ON).offers as Record<string, unknown>).availability).toBe(
      'https://schema.org/OutOfStock',
    )
    expect((productJsonLd(product({ is_active: false }), ALL_ON).offers as Record<string, unknown>).availability).toBe(
      'https://schema.org/Discontinued',
    )
  })

  it('omits whatever the page hides', () => {
    const ld = productJsonLd(product(), {
      show_price_detail: false,
      show_stock_detail: false,
      show_sku_barcode_detail: false,
      show_category_detail: false,
    })
    expect(ld).not.toHaveProperty('offers')
    expect(ld).not.toHaveProperty('sku')
    expect(ld).not.toHaveProperty('gtin')
    expect(ld).not.toHaveProperty('category')
    const priceOnly = productJsonLd(product(), { ...ALL_ON, show_stock_detail: false })
    expect(priceOnly.offers).not.toHaveProperty('availability')
  })

  it('never offers a $0 price', () => {
    expect(productJsonLd(product({ price_cents: 0 }), ALL_ON)).not.toHaveProperty('offers')
  })
})

describe('jsonLdScript', () => {
  it('cannot be closed early by a product name containing </script>', () => {
    const out = jsonLdScript(productJsonLd(product({ name: 'Evil </script><script>alert(1)</script>' }), ALL_ON))
    expect(out).not.toContain('</script>')
    expect(JSON.parse(out).name).toContain('</script>')
  })
})
