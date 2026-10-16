'use client'

import { US_STATE_NAMES, normalizeUsState } from '@/lib/us-states'

// US state picker for ship-to addresses (cart, address book). Always yields a
// two-letter code; an older free-text value ("Texas", "tx") is shown as its code.
export default function StateSelect({
  id,
  value,
  onChange,
  required,
  className = 'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500',
}: {
  id?: string
  value: string
  onChange: (code: string) => void
  required?: boolean
  className?: string
}) {
  const code = normalizeUsState(value) ?? ''
  return (
    <select id={id} value={code} required={required} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">Choose…</option>
      {Object.entries(US_STATE_NAMES).map(([c, name]) => (
        <option key={c} value={c}>
          {c} — {name}
        </option>
      ))}
    </select>
  )
}
