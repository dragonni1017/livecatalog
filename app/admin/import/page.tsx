import Link from 'next/link'
import ExcelDropzone from '@/components/admin/ExcelDropzone'

export default function ImportPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/admin"
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Dashboard
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-2xl font-bold text-gray-900">Import Products</h1>
        </div>

        {/* Template download */}
        <div className="mb-6 rounded-lg bg-white border border-gray-200 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Need the template?</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Download the blank Excel template with all required columns.
            </p>
          </div>
          <a
            href="/template.xlsx"
            download
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors flex-shrink-0 ml-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download template.xlsx
          </a>
        </div>

        {/* Main dropzone component */}
        <ExcelDropzone />
      </div>
    </div>
  )
}
