import { describe, it, expect } from 'vitest'
import { RENAMED_CATEGORY_SLUGS, resolveCategorySlug } from '@/lib/category-slugs'

const BEFORE = ['papers', 'christmas', 'slippers', 'plush-toys']
const AFTER = ['papers', 'seasonal-holiday', 'accessories-apparel', 'toys-novelties']

describe('resolveCategorySlug', () => {
  it('keeps an old slug while it still exists (code deployed before the SQL)', () => {
    expect(resolveCategorySlug('christmas', BEFORE)).toBe('christmas')
    expect(resolveCategorySlug('plush-toys', BEFORE)).toBe('plush-toys')
  })

  it('moves an old slug to its new one once renamed', () => {
    expect(resolveCategorySlug('christmas', AFTER)).toBe('seasonal-holiday')
    expect(resolveCategorySlug('slippers', AFTER)).toBe('accessories-apparel')
    expect(resolveCategorySlug('plush-toys', AFTER)).toBe('toys-novelties')
  })

  it('leaves current, unknown and half-renamed slugs alone', () => {
    expect(resolveCategorySlug('seasonal-holiday', AFTER)).toBe('seasonal-holiday')
    expect(resolveCategorySlug('papers', AFTER)).toBe('papers')
    expect(resolveCategorySlug('nonsense', AFTER)).toBe('nonsense')
    // Old slug gone but the new one missing too: no redirect to a dead page.
    expect(resolveCategorySlug('mirrors', AFTER)).toBe('mirrors')
  })

  it('never maps a slug onto another old slug, so a redirect cannot loop', () => {
    const olds = new Set(Object.keys(RENAMED_CATEGORY_SLUGS))
    for (const to of Object.values(RENAMED_CATEGORY_SLUGS)) expect(olds.has(to)).toBe(false)
  })
})
