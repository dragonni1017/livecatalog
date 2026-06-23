'use client'

import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'

interface BarcodeProps {
  value: string
}

// Spreadsheet tools (Excel, Google Sheets) commonly store a GTIN/UPC/EAN
// column as a Number rather than Text, which silently drops a leading
// zero — "012345678905" becomes 12345678905. That one missing digit is
// enough for a barcode to scan to a different item than intended.
//
// UPC-A (12 digits) and EAN-8 (8 digits) have no legitimate shorter form
// in this catalog, so an 11- or 7-digit numeric value is almost always
// the zero-stripped version of one of those — safe to re-pad. A 12-digit
// value is left alone: it could be a correct UPC-A as-is, or a
// zero-stripped EAN-13, and guessing wrong would encode the wrong
// number. (The import pipeline now preserves the zero at the source —
// see ExcelDropzone.tsx — this is just a safety net for older rows.)
function normalizeBarcode(value: string): string {
  if (/^\d{11}$/.test(value)) return '0' + value
  if (/^\d{7}$/.test(value)) return '0' + value
  return value
}

// Pick the most appropriate symbology from the value's shape.
// Retail codes are UPC-A (12 digits) / EAN-13 (13) / EAN-8 (8); anything else
// (alphanumeric or odd length) falls back to CODE128, which encodes any string.
function formatFor(value: string): string {
  if (/^\d{12}$/.test(value)) return 'UPC'
  if (/^\d{13}$/.test(value)) return 'EAN13'
  if (/^\d{8}$/.test(value)) return 'EAN8'
  return 'CODE128'
}

/**
 * Renders a real, scannable barcode from a product's barcode value.
 * Client-only (JsBarcode draws into the DOM). Degrades gracefully: if the
 * value fails its symbology's checksum, it retries with CODE128, and if that
 * also fails it shows the plain number so the page never breaks.
 */
export default function Barcode({ value }: BarcodeProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [failed, setFailed] = useState(false)
  const normalized = value ? normalizeBarcode(value) : value

  useEffect(() => {
    const el = svgRef.current
    if (!el || !value) return

    const opts = {
      displayValue: true,
      width: 2,
      height: 60,
      fontSize: 14,
      margin: 0,
      background: '#ffffff',
    }

    try {
      JsBarcode(el, normalized, { ...opts, format: formatFor(normalized) })
      setFailed(false)
    } catch {
      try {
        JsBarcode(el, normalized, { ...opts, format: 'CODE128' })
        setFailed(false)
      } catch {
        setFailed(true)
      }
    }
  }, [value])

  if (failed) {
    return <p className="text-xs text-gray-400 font-mono">Barcode: {normalized}</p>
  }

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Barcode</p>
      <svg ref={svgRef} aria-label={`Barcode ${normalized}`} role="img" className="max-w-full" />
    </div>
  )
}
