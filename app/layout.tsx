import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Suspense } from 'react'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
import { CartProvider } from '@/lib/cart-context'
import { FavoritesProvider } from '@/lib/favorites-context'
import RepCapture from '@/components/catalog/RepCapture'

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
    <html lang="en" className={`h-full ${inter.variable}`}>
      <body className="min-h-full bg-gray-50 text-gray-900 antialiased font-sans">
        <Suspense fallback={null}>
          <RepCapture />
        </Suspense>
        <FavoritesProvider>
          <CartProvider>{children}</CartProvider>
        </FavoritesProvider>
      </body>
    </html>
  )
}
