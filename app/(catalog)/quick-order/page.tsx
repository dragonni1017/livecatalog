import type { Metadata } from 'next'
import Link from 'next/link'
import QuickOrder from '@/components/catalog/QuickOrder'

export const metadata: Metadata = {
  title: 'Quick Order',
  description: 'Paste a list of SKUs to add many products to your cart at once.',
}

export default function QuickOrderPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to catalog
        </Link>
      </div>

      <h1 className="mb-2 text-2xl font-bold text-gray-900">Quick Order</h1>
      <p className="mb-6 text-sm text-gray-600">
        Already know what you need? Paste your SKUs below to add them all to your cart at once, then
        submit a quote request as usual.
      </p>

      <QuickOrder />
    </div>
  )
}
