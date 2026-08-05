import Link from 'next/link'
import BulkVisibilityActions from '@/components/admin/BulkVisibilityActions'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export default async function AdminDashboard() {
  let qbPending = 0
  try {
    const db = getAdminClient()
    const { count } = await db
      .from('order_requests')
      .select('id', { count: 'exact', head: true })
      .eq('entered_in_qb', false)
      .neq('status', 'lost')
    qbPending = count ?? 0
  } catch {
    // non-fatal — dashboard still renders without the count
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <a
            href="/api/admin/auth?action=logout"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Sign out
          </a>
        </div>

        {/* Workflow note */}
        <div className="mb-6 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
          Export your product list from QuickBooks, then upload it here to update the catalog.
        </div>

        {/* Action cards */}
        <div className="grid gap-4">
          <Link
            href="/admin/import"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Import Products from Excel
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Drag and drop an .xlsx file to update the product catalog
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/orders"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Order Requests
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Review incoming quote requests and update their status
              </p>
              {qbPending > 0 && (
                <p className="mt-1.5 text-xs font-medium text-amber-700">
                  {qbPending} order{qbPending !== 1 ? 's' : ''} not yet entered in QB
                </p>
              )}
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/customers"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Customer Profiles
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Manage buyer discount rates — informational reference for QuickBooks entry
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/users"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Registered Users
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Buyers who created an account — sign-up date, last login, and order history
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/credit-applications"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Net-Terms Applications
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Review buyer applications for net-30 / net-60 payment terms
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/price-list"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Printable Price List
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Generate a print/PDF price sheet by category to send to reps and customers
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/products"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Products &amp; Stock
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Show/hide products, edit details, and adjust stock quantities manually
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/display-settings"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Display Settings
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Show/hide stock, SKU/barcode, category, and pack info on the storefront
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/imports"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Import History
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                See what each Excel import changed (new, updated, deactivated)
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/sync"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Erply Sync
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Preview and run an Erply product/stock sync on demand
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/analytics"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Analytics
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Most-viewed products and top search terms (last 30 days)
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/zero-results"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Zero-Result Searches
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Search terms that returned no products — catalog gaps or typos
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/reps"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Rep Performance
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Orders, revenue, and conversion rates by rep link
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/admin/audit-log"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                Audit Log
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                History of admin actions — stock adjustments and order status changes
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <div className="rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">Product Visibility</h2>
            <p className="text-sm text-gray-500 mt-0.5 mb-4">
              Bulk hide or re-enable products based on whether they have an image
            </p>
            <BulkVisibilityActions />
          </div>

          <Link
            href="/admin/2fa-setup"
            className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-6 py-5 shadow-sm hover:border-red-300 hover:shadow-md transition-all group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900 group-hover:text-red-600 transition-colors">
                2FA Setup
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Configure two-factor authentication for the admin login
              </p>
            </div>
            <svg
              className="w-5 h-5 text-gray-400 group-hover:text-red-500 transition-colors flex-shrink-0 ml-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* Status note */}
        <p className="mt-6 text-xs text-gray-400">
          Last import: data stored in Supabase
        </p>
      </div>
    </div>
  )
}
