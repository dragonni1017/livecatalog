import type { Metadata } from 'next'
import './globals.css'
import { CartProvider } from '@/lib/cart-context'

export const metadata: Metadata = {
  metadataBase: new URL('https://livecatalog.vercel.app'),
  title: {
    default: 'L & Y USA — Wholesale Product Catalog',
    template: '%s · L & Y USA',
  },
  description:
    'Browse the L & Y USA wholesale product catalog — party supplies, gift items, and more. Search by name or SKU, check live availability, and request a quote.',
  openGraph: {
    title: 'L & Y USA — Wholesale Product Catalog',
    description: 'Browse our wholesale catalog, check availability, and request a quote.',
    siteName: 'L & Y USA',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-gray-50 text-gray-900 antialiased font-sans">
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  )
}
