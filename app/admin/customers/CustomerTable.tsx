'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Customer {
  id: string
  email: string
  name: string | null
  company: string | null
  discount_percent: number
  notes: string | null
  created_at: string
  updated_at: string
  order_count: number
}

interface AddForm {
  email: string
  name: string
  company: string
  discount_percent: string
  notes: string
}

const EMPTY_FORM: AddForm = { email: '', name: '', company: '', discount_percent: '0', notes: '' }

export default function CustomerTable({ initialCustomers }: { initialCustomers: Customer[] }) {
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers)
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_FORM)
  const [addError, setAddError] = useState<string | null>(null)
  const [addSaving, setAddSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<AddForm>>({})
  const [editError, setEditError] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // ---- Add ----------------------------------------------------------------

  async function handleAdd() {
    setAddError(null)
    if (!addForm.email.trim()) {
      setAddError('Email is required.')
      return
    }
    const discount = parseFloat(addForm.discount_percent)
    if (isNaN(discount) || discount < 0 || discount > 100) {
      setAddError('Discount must be between 0 and 100.')
      return
    }

    setAddSaving(true)
    try {
      const res = await fetch('/admin/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: addForm.email.trim(),
          name: addForm.name.trim() || null,
          company: addForm.company.trim() || null,
          discount_percent: discount,
          notes: addForm.notes.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setAddError(json.error ?? 'Failed to save.')
        return
      }
      if (json.customer) {
        setCustomers(prev => [...prev, json.customer as Customer])
      }
      setAdding(false)
      setAddForm(EMPTY_FORM)
    } catch {
      setAddError('Network error. Please try again.')
    } finally {
      setAddSaving(false)
    }
  }

  // ---- Edit ---------------------------------------------------------------

  function startEdit(c: Customer) {
    setEditingId(c.id)
    setEditForm({
      name: c.name ?? '',
      company: c.company ?? '',
      discount_percent: String(c.discount_percent),
      notes: c.notes ?? '',
    })
    setEditError(null)
  }

  async function handleSaveEdit(id: string) {
    setEditError(null)
    const discount = parseFloat(editForm.discount_percent ?? '0')
    if (isNaN(discount) || discount < 0 || discount > 100) {
      setEditError('Discount must be between 0 and 100.')
      return
    }

    setEditSaving(true)
    try {
      const res = await fetch('/admin/api/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: editForm.name?.trim() || null,
          company: editForm.company?.trim() || null,
          discount_percent: discount,
          notes: editForm.notes?.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setEditError(json.error ?? 'Failed to update.')
        return
      }
      setCustomers(prev =>
        prev.map(c =>
          c.id === id
            ? {
                ...c,
                name: editForm.name?.trim() || null,
                company: editForm.company?.trim() || null,
                discount_percent: discount,
                notes: editForm.notes?.trim() || null,
              }
            : c
        )
      )
      setEditingId(null)
    } catch {
      setEditError('Network error. Please try again.')
    } finally {
      setEditSaving(false)
    }
  }

  // ---- Delete -------------------------------------------------------------

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Delete customer "${label}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/admin/api/customers?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        alert(json.error ?? 'Failed to delete.')
        return
      }
      setCustomers(prev => prev.filter(c => c.id !== id))
    } catch {
      alert('Network error. Please try again.')
    }
  }

  // ---- Render -------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        {/* Back link */}
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>

        {/* Header row */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Customer Profiles</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage buyer discount rates. Discounts are informational — apply them manually in QuickBooks.
            </p>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-shrink-0 ml-6">
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
              {customers.length} {customers.length === 1 ? 'customer' : 'customers'}
            </span>
            <button
              onClick={() => { setAdding(true); setAddForm(EMPTY_FORM); setAddError(null) }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
            >
              Add customer
            </button>
          </div>
        </div>

        {/* Add form */}
        {adding && (
          <div className="mt-6 rounded-xl bg-white border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">New Customer</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="buyer@company.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Jane Smith"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                <input
                  type="text"
                  value={addForm.company}
                  onChange={e => setAddForm(f => ({ ...f, company: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Acme Retail"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Discount %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={addForm.discount_percent}
                  onChange={e => setAddForm(f => ({ ...f, discount_percent: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={addForm.notes}
                  onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Optional notes..."
                />
              </div>
            </div>
            {addError && (
              <p className="mt-3 text-sm text-red-600">{addError}</p>
            )}
            <div className="mt-4 flex gap-3">
              <button
                onClick={handleAdd}
                disabled={addSaving}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {addSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setAdding(false); setAddError(null) }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="mt-6 rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          {customers.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-gray-500">
                No customer profiles yet. Add one above to start tracking buyer discounts.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Discount %</th>
                    <th className="px-4 py-3">Orders</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {customers.map(c =>
                    editingId === c.id ? (
                      <tr key={c.id} className="bg-red-50">
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={editForm.company ?? ''}
                            onChange={e => setEditForm(f => ({ ...f, company: e.target.value }))}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={editForm.name ?? ''}
                            onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </td>
                        <td className="px-4 py-3 text-gray-500">{c.email}</td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={editForm.discount_percent ?? '0'}
                            onChange={e => setEditForm(f => ({ ...f, discount_percent: e.target.value }))}
                            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{c.order_count}</td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={editForm.notes ?? ''}
                            onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            {editError && (
                              <span className="text-xs text-red-600">{editError}</span>
                            )}
                            <button
                              onClick={() => handleSaveEdit(c.id)}
                              disabled={editSaving}
                              className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                              {editSaving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{c.company ?? <span className="text-gray-400">—</span>}</td>
                        <td className="px-4 py-3 text-gray-700">{c.name ?? <span className="text-gray-400">—</span>}</td>
                        <td className="px-4 py-3 text-gray-600">{c.email}</td>
                        <td className="px-4 py-3">
                          {c.discount_percent > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                              {c.discount_percent}%
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {c.order_count > 0 ? (
                            <Link
                              href={`/admin/orders?email=${encodeURIComponent(c.email)}`}
                              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                            >
                              {c.order_count} order{c.order_count !== 1 ? 's' : ''}
                            </Link>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{c.notes ?? <span className="text-gray-400">—</span>}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => startEdit(c)}
                              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(c.id, c.company ?? c.email)}
                              className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
