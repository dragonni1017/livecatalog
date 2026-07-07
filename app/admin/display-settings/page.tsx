import Link from 'next/link'
import { getDisplaySettings } from '@/lib/display-settings'
import DisplaySettingsForm from '@/components/admin/DisplaySettingsForm'

export const dynamic = 'force-dynamic'

export default async function DisplaySettingsPage() {
  const settings = await getDisplaySettings()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Display Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Control what shows up on the storefront — separately for the main catalog listing and individual product pages.
          </p>
        </div>

        <DisplaySettingsForm initialSettings={settings} />
      </div>
    </div>
  )
}
