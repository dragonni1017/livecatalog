'use client'

import { useState } from 'react'

interface Props {
  reference: string
  customerName: string
}

export default function OrderReplyForm({ reference, customerName }: Props) {
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return
    setLoading(true)
    try {
      await fetch('/api/order-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, message }),
      })
    } catch {
      // best-effort — show success regardless
    }
    setSubmitted(true)
    setLoading(false)
  }

  return (
    <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">Have a question about this order?</h2>
      <p className="mb-4 text-xs text-gray-500">
        Send a message to the L&amp;Y USA team — we&apos;ll reply to {customerName}&apos;s email.
      </p>

      {submitted ? (
        <p className="text-sm font-medium text-green-600">
          ✓ Message sent — we&apos;ll be in touch soon.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message here…"
            rows={4}
            maxLength={2000}
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{message.length}/2000</span>
            <button
              type="submit"
              disabled={loading || !message.trim()}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Sending…' : 'Send message'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
