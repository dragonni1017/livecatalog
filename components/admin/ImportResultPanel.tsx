'use client'

import type { ImportResult } from '@/lib/types'

interface ImportResultPanelProps {
  result: ImportResult
  onReset: () => void
}

export default function ImportResultPanel({ result, onReset }: ImportResultPanelProps) {
  const hasImportErrors = result.errors.length > 0

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border px-5 py-4 ${hasImportErrors ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
        <p className={`text-base font-semibold ${hasImportErrors ? 'text-amber-800' : 'text-green-800'}`}>
          ✓ Import complete
        </p>
        <p className="text-sm mt-1 text-gray-600">
          <span className="font-medium text-green-700">{result.inserted} inserted</span>
          {' · '}
          <span className="font-medium text-blue-700">{result.updated} updated</span>
          {' · '}
          <span className="font-medium text-gray-500">{result.deactivated} deactivated</span>
          {' · '}
          <span className="font-medium text-gray-400">{result.skipped} skipped</span>
        </p>
      </div>

      {hasImportErrors && (
        <div className="rounded-xl bg-white border border-red-200 overflow-hidden">
          <div className="px-4 py-3 bg-red-50 border-b border-red-200">
            <p className="text-sm font-semibold text-red-700">
              {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} had errors
            </p>
          </div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Row</th>
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">SKU</th>
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.errors.map((err, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-gray-500">{err.row || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">{err.sku || '—'}</td>
                    <td className="px-4 py-2 text-red-600">{err.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <button onClick={onReset} className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors">
        Import Another File
      </button>
    </div>
  )
}
