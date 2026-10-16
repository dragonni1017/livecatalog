import { describe, expect, it } from 'vitest'
import jsQR from 'jsqr'
import { productUrl, qrPath, qrProductUrl } from '../lib/qr'

// Decodes the exact path data the line card prints, so this proves the
// printed code scans to the right URL, not just that an <svg> appeared.
function decode({ size, d }: { size: number; d: string }): string | null {
  const SCALE = 6
  const QUIET = 4 // modules of white border, as a scanner expects
  const px = (size + QUIET * 2) * SCALE
  const rgba = new Uint8ClampedArray(px * px * 4).fill(255)
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x0 = (Number(m[1]) + QUIET) * SCALE
    const y0 = (Number(m[2]) + QUIET) * SCALE
    for (let y = y0; y < y0 + SCALE; y++) {
      for (let x = x0; x < x0 + SCALE; x++) {
        const i = (y * px + x) * 4
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0
      }
    }
  }
  return jsQR(rgba, px, px)?.data ?? null
}

describe('productUrl', () => {
  it('points at the live product page', () => {
    expect(productUrl('prod-00042')).toBe('https://lyusa.app/product/prod-00042')
  })
  it('encodes anything unusual in the id', () => {
    expect(productUrl('a b/c')).toBe('https://lyusa.app/product/a%20b%2Fc')
  })
})

describe('qrProductUrl', () => {
  it('is the product page tagged as a QR scan', () => {
    expect(qrProductUrl('prod-00042')).toBe('https://lyusa.app/product/prod-00042?src=qr')
  })
})

describe('qrPath', () => {
  it('scans back to the exact tagged URL the line card prints', () => {
    for (const id of ['prod-00001', 'prod-03171', 'prod-99999']) {
      const url = qrProductUrl(id)
      expect(decode(qrPath(url))).toBe(url)
    }
  })
  it('an untagged product URL also decodes', () => {
    expect(decode(qrPath(productUrl('prod-00001')))).toBe(productUrl('prod-00001'))
  })
  it('stays a small code (≤ 33 modules) so it prints legibly at half an inch', () => {
    expect(qrPath(qrProductUrl('prod-99999')).size).toBeLessThanOrEqual(33)
  })
  it('only emits unit squares inside the grid', () => {
    const { size, d } = qrPath(productUrl('prod-00001'))
    const squares = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)]
    expect(squares.length).toBeGreaterThan(0)
    expect(squares.map((m) => m[0]).join('')).toBe(d) // nothing else in the path
    for (const m of squares) {
      expect(Number(m[1])).toBeLessThan(size)
      expect(Number(m[2])).toBeLessThan(size)
    }
  })
})
