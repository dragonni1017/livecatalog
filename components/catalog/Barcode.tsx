'use client'

import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'

interface BarcodeProps {
  value: string
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
      JsBarcode(el, value, { ...opts, format: formatFor(value) })
      setFailed(false)
    } catch {
      try {
        JsBarcode(el, value, { ...opts, format: 'CODE128' })
        setFailed(false)
      } catch {
        setFailed(true)
      }
    }
  }, [value])

  if (failed) {
    return <p className="text-xs text-gray-400 font-mono">Barcode: {value}</p>
  }

  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Barcode</p>
      <svg ref={svgRef} aria-label={`Barcode ${value}`} role="img" className="max-w-full" />
    </div>
  )
}
