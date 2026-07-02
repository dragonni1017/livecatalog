// Shared site footer — rendered once from app/(catalog)/layout.tsx so every
// public page (homepage, product, cart, account, etc.) gets the same
// warehouse/store address + phone block. Previously this only existed inline
// on the homepage (app/page.tsx) and nowhere else; extracted 2026-06-29.
import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="mt-12 border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 flex-col items-center justify-center border-2 border-gray-900">
              <span className="font-black text-gray-900" style={{ fontSize: '8px', letterSpacing: '-0.5px' }}>
                L &amp; Y
              </span>
              <span className="font-bold text-gray-900" style={{ fontSize: '7px' }}>
                USA
              </span>
            </div>
            <span className="text-sm font-bold text-gray-900">L &amp; Y USA</span>
          </div>
          <div className="flex flex-col gap-1 text-xs text-gray-500 sm:text-right">
            <p><span className="font-medium text-gray-700">Warehouse:</span> 3183 Bandini Blvd, Vernon, CA 90058</p>
            <p><span className="font-medium text-gray-700">Store:</span> 310 South Los Angeles St., Los Angeles, CA 90013</p>
          </div>
          <div className="text-xs text-gray-500">
            <p className="font-medium text-gray-700">626-552-4120</p>
            <p>www.ly-usa.com</p>
            <Link href="/credit-application" className="mt-1 inline-block text-red-600 hover:text-red-700 hover:underline">
              Apply for net terms →
            </Link>
          </div>
        </div>
      </div>
      {/* Red accent bar */}
      <div className="h-1.5 bg-red-600" />
    </footer>
  )
}
