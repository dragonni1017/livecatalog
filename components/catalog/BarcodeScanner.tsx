'use client'

import { useRef, useState } from 'react'

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] })
  detect(image: HTMLVideoElement): Promise<Array<{ rawValue: string }>>
  static getSupportedFormats(): Promise<string[]>
}

interface BarcodeScannerProps {
  onScan: (value: string) => void
}

export default function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const [open, setOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const detectorRef = useRef<BarcodeDetector | null>(null)

  function stopCamera() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  function handleClose() {
    stopCamera()
    setOpen(false)
  }

  async function handleOpen() {
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
      alert('Barcode scanning is not supported in this browser')
      return
    }

    setOpen(true)

    try {
      const formats = await BarcodeDetector.getSupportedFormats()
      detectorRef.current = new BarcodeDetector({ formats })
    } catch {
      detectorRef.current = new BarcodeDetector()
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream

      // Wait for the video element to be in the DOM
      await new Promise<void>(resolve => setTimeout(resolve, 50))

      if (!videoRef.current) {
        stopCamera()
        return
      }
      videoRef.current.srcObject = stream
      await videoRef.current.play()

      scanLoop()
    } catch {
      stopCamera()
      setOpen(false)
      alert('Could not access camera. Please allow camera permissions and try again.')
    }
  }

  function scanLoop() {
    const video = videoRef.current
    const detector = detectorRef.current
    if (!video || !detector || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(scanLoop)
      return
    }

    detector
      .detect(video)
      .then(results => {
        if (results.length > 0 && results[0].rawValue) {
          onScan(results[0].rawValue)
          handleClose()
        } else {
          rafRef.current = requestAnimationFrame(scanLoop)
        }
      })
      .catch(() => {
        rafRef.current = requestAnimationFrame(scanLoop)
      })
  }

  return (
    <>
      {/* Camera trigger button */}
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Scan barcode"
        className="rounded-lg border border-gray-300 p-2 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 9V6a1 1 0 011-1h3M3 15v3a1 1 0 001 1h3m10-16h3a1 1 0 011 1v3m0 10v3a1 1 0 01-1 1h-3"
          />
          <line x1="7" y1="12" x2="7" y2="12.01" strokeLinecap="round" />
          <line x1="10" y1="12" x2="10" y2="12.01" strokeLinecap="round" />
          <line x1="13" y1="12" x2="13" y2="12.01" strokeLinecap="round" />
          <line x1="16" y1="12" x2="16" y2="12.01" strokeLinecap="round" />
          <line x1="7" y1="8" x2="17" y2="8" strokeLinecap="round" />
          <line x1="7" y1="16" x2="17" y2="16" strokeLinecap="round" />
        </svg>
      </button>

      {/* Fullscreen scanning overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
          {/* Video feed */}
          <video
            ref={videoRef}
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />

          {/* Viewfinder overlay */}
          <div className="relative z-10 flex flex-col items-center gap-6">
            {/* Red corner brackets */}
            <div className="relative h-56 w-56">
              {/* Top-left */}
              <span className="absolute left-0 top-0 block h-8 w-8 border-l-4 border-t-4 border-red-500" />
              {/* Top-right */}
              <span className="absolute right-0 top-0 block h-8 w-8 border-r-4 border-t-4 border-red-500" />
              {/* Bottom-left */}
              <span className="absolute bottom-0 left-0 block h-8 w-8 border-b-4 border-l-4 border-red-500" />
              {/* Bottom-right */}
              <span className="absolute bottom-0 right-0 block h-8 w-8 border-b-4 border-r-4 border-red-500" />
            </div>

            <p className="text-sm text-white/80 drop-shadow">
              Point camera at a barcode or QR code
            </p>

            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-white/30 bg-black/40 px-5 py-2 text-sm font-medium text-white backdrop-blur hover:bg-black/60 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
