import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ draftMode: vi.fn(), cookies: vi.fn() }))
vi.mock('@/lib/auth-server', () => ({ getSessionUser: vi.fn() }))

import { draftMode } from 'next/headers'
import { getSessionUser } from '@/lib/auth-server'
import { hiddenReason, showAllProducts } from '@/lib/admin-catalog-view'

const setDraft = (isEnabled: boolean) => vi.mocked(draftMode).mockResolvedValue({ isEnabled } as never)
const setUser = (role: string | null) =>
  vi.mocked(getSessionUser).mockResolvedValue(role ? ({ app_metadata: { role } } as never) : null)

describe('showAllProducts', () => {
  it('is on only with the draft cookie AND an admin session', async () => {
    setDraft(true); setUser('admin')
    expect(await showAllProducts()).toBe(true)
    setDraft(true); setUser('rep')
    expect(await showAllProducts()).toBe(false)
    setDraft(true); setUser(null)
    expect(await showAllProducts()).toBe(false)
    setDraft(false); setUser('admin')
    expect(await showAllProducts()).toBe(false)
  })

  it('never looks up the session without the draft cookie', async () => {
    vi.mocked(getSessionUser).mockClear()
    setDraft(false)
    await showAllProducts()
    expect(getSessionUser).not.toHaveBeenCalled()
  })
})

describe('hiddenReason', () => {
  it('names why customers cannot see a product', () => {
    expect(hiddenReason({ is_active: false, manually_hidden: true })).toBe('Inactive')
    expect(hiddenReason({ is_active: true, manually_hidden: true })).toBe('Hidden')
    expect(hiddenReason({ is_active: true, manually_hidden: false })).toBeNull()
  })
})
