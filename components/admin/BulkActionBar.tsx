'use client'

interface BulkActionBarProps {
  selectedCount: number
  mode: 'adjust' | 'set'
  amount: string
  loading: boolean
  result: { message: string; ok: boolean } | null
  onModeChange: (mode: 'adjust' | 'set') => void
  onAmountChange: (value: string) => void
  onApply: () => void
  onClearSelection: () => void
}

export default function BulkActionBar({
  selectedCount,
  mode,
  amount,
  loading,
  result,
  onModeChange,
  onAmountChange,
  onApply,
  onClearSelection,
}: BulkActionBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg px-4 py-3 flex items-center gap-4 flex-wrap">
      <span className="text-sm text-gray-500 shrink-0">
        <span className="font-semibold text-gray-900">{selectedCount}</span>{' '}
        {selectedCount === 1 ? 'product' : 'products'} selected
      </span>

      {/* Mode toggle pills */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
        <button
          type="button"
          onClick={() => onModeChange('adjust')}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === 'adjust'
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          Adjust by
        </button>
        <button
          type="button"
          onClick={() => onModeChange('set')}
          className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200 ${
            mode === 'set'
              ? 'bg-gray-900 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          Set to
        </button>
      </div>

      {/* Amount input */}
      <input
        type="number"
        value={amount}
        onChange={(e) => onAmountChange(e.target.value)}
        placeholder={mode === 'adjust' ? 'e.g. −5 or 10' : 'e.g. 0 or 50'}
        className="w-32 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
      />

      {/* Apply button */}
      <button
        type="button"
        onClick={onApply}
        disabled={loading || amount === ''}
        className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors shrink-0"
      >
        {loading ? 'Applying…' : 'Apply'}
      </button>

      {/* Result message */}
      {result && (
        <span className={`text-sm font-medium ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
          {result.message}
        </span>
      )}

      {/* Clear selection */}
      <button
        type="button"
        onClick={onClearSelection}
        className="ml-auto text-sm text-gray-400 hover:text-gray-600 transition-colors shrink-0"
      >
        Clear selection
      </button>
    </div>
  )
}
