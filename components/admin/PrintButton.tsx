'use client'

// Triggers the browser's print dialog (which also offers "Save as PDF").
// Kept tiny and client-only so the print page itself can stay a server component.
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
    >
      Print / Save as PDF
    </button>
  )
}
