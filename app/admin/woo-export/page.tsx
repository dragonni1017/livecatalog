import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { buildExport, type Missing } from '@/lib/woo-export'
import { loadExportData } from '@/lib/woo-export-load'
import { WOO_CATEGORY_PATHS } from '@/lib/woo-categories'

export const dynamic = 'force-dynamic'

// WooCommerce export: which catalog products are ready for the WordPress
// store, two CSV downloads, and how to import them (lib/woo-export.ts).

const MISSING_ORDER: Missing[] = ['photo', 'price', 'category', 'description', 'hidden on purpose']
const GUESSES = Object.entries(WOO_CATEGORY_PATHS).filter(([, w]) => w.guess)

export default async function WooExportPage() {
  const { products, categoryOf } = await loadExportData(getAdminClient())
  const { ready, almost } = buildExport(products, categoryOf, { images: false, categories: false })
  // With Categories on, ready products whose category has no WooCommerce path are left out.
  const { unmappedCategory } = buildExport(products, categoryOf, { images: false, categories: true })
  const byMissing = new Map<Missing, number>()
  for (const a of almost) for (const m of a.missing) byMissing.set(m, (byMissing.get(m) ?? 0) + 1)
  const oneAway = almost.filter((a) => a.missing.length === 1 && a.missing[0] !== 'hidden on purpose').length

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Dashboard</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">WooCommerce export</h1>
        <p className="mt-1 text-sm text-gray-500">
          The catalog&apos;s ready products as a file WooCommerce&apos;s own importer reads. Ready means active, shown in the
          catalog, with a photo, a price, a category and a written description.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-green-200 bg-green-50 p-5">
            <p className="text-3xl font-bold text-green-800">{ready.length.toLocaleString()}</p>
            <p className="text-sm text-green-900">ready for WooCommerce</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-3xl font-bold text-amber-800">{almost.length.toLocaleString()}</p>
            <p className="text-sm text-amber-900">
              not ready yet{oneAway ? ` (${oneAway.toLocaleString()} missing just one thing)` : ''}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5 text-sm">
          <p className="font-semibold text-gray-900">What the others are missing</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {MISSING_ORDER.filter((m) => byMissing.has(m)).map((m) => (
              <li key={m} className="flex justify-between gap-4 text-gray-700">
                <span>{m === 'hidden on purpose' ? 'Hidden on purpose (owner decision)' : `No ${m}`}</span>
                <span className="font-semibold">{byMissing.get(m)!.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            A product can be missing several. Fix them in Cleanup, Price review and the Photo shot list; they join the ready
            file by themselves.
          </p>
        </div>

        <form action="/admin/api/woo-export" method="get" className="mt-6 rounded-xl border border-gray-200 bg-white p-5 text-sm">
          <p className="font-semibold text-gray-900">Download</p>
          <input type="hidden" name="file" value="ready" />
          <p className="mt-2 text-gray-600">
            Always included: SKU, published and visible, short description (first sentence) and description.
          </p>
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" name="categories" value="1" className="mt-0.5" />
            <span>
              Categories{' '}
              <span className="text-gray-500">
                (sends WooCommerce&apos;s own category path, e.g. &quot;Florals/Gifts &gt; Papers&quot;, so the importer
                files each product under an existing category instead of creating a new one. Best guesses, worth a
                look: {GUESSES.map(([name, w]) => `${name} → ${w.path}`).join('; ')})
              </span>
              {unmappedCategory.length > 0 && (
                <span className="block text-amber-700">
                  {unmappedCategory.length} ready product{unmappedCategory.length === 1 ? '' : 's'} would be left out with
                  this on: no WooCommerce category for {[...new Set(unmappedCategory.map((u) => u.category))].join(', ')}.
                </span>
              )}
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2">
            <input type="checkbox" name="images" value="1" className="mt-0.5" />
            <span>
              Images <span className="text-gray-500">(WooCommerce already has these; re-importing downloads copies into its media library)</span>
            </span>
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="submit" className="rounded-md bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700">
              Download ready products ({ready.length.toLocaleString()})
            </button>
            <a
              href="/admin/api/woo-export?file=almost"
              className="rounded-md border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50"
            >
              Download &quot;not ready yet&quot; list ({almost.length.toLocaleString()})
            </a>
          </div>
        </form>

        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-700">
          <p className="font-semibold text-gray-900">How to import</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>First, export the current products from WooCommerce (Products → Export) and keep that file. It&apos;s the undo.</li>
            <li>Make a copy of the ready file with only about 10 rows, to test.</li>
            <li>In WooCommerce: Products → Import → choose the file → tick <strong>Update existing products</strong> → Continue.</li>
            <li>Check the column mapping (it should match on its own), run it, and look at those 10 products on the site.</li>
            <li>Then import the full file the same way.</li>
          </ol>
          <p className="mt-3 text-xs text-gray-500">
            Name, price and stock are left out on purpose: Erply&apos;s WooCommerce Integration sends those, and would undo any
            difference on its next run. WooCommerce matches rows by SKU and leaves columns that aren&apos;t in the file alone.
            Check first whether Erply&apos;s integration also syncs descriptions (Field mapping); if it does, it may overwrite them.
          </p>
        </div>
      </div>
    </div>
  )
}
