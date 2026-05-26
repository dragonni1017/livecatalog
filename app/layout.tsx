import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Product Catalog',
  description: 'Browse our full product catalog',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-gray-50 text-gray-900 antialiased font-sans">
        {children}
      </body>
    </html>
  )
}
