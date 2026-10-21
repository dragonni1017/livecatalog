import { describe, it, expect } from 'vitest'
import {
  categorySlugFor,
  matchExistingCategory,
  RENAMED_CATEGORY_SLUGS,
  resolveCategorySlug,
} from '@/lib/category-slugs'

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

describe('categorySlugFor', () => {
  it('makes the same shape as the hand-curated slugs', () => {
    expect(categorySlugFor('Seasonal & Holiday')).toBe('seasonal-holiday')
    expect(categorySlugFor('LED/Electronics')).toBe('led-electronics')
    expect(categorySlugFor('Bags/Purses')).toBe('bags-purses')
    expect(categorySlugFor('3D Printed')).toBe('3d-printed')
    expect(categorySlugFor('  Fan  ')).toBe('fan')
  })
})

describe('matchExistingCategory', () => {
  // Real rows as of 2026-10-21, plus a made-up one in the legacy
  // double-dash slug shape.
  const CATS = [
    { id: 'cat-019', name: 'Fan', slug: 'fan' },
    { id: 'cat-064', name: 'Seasonal & Holiday', slug: 'seasonal-holiday' },
    { id: 'cat-047', name: 'Toys & Novelties', slug: 'toys-novelties' },
    { id: 'cat-036', name: 'LED/Electronics', slug: 'led-electronics' },
    { id: 'cat-099', name: 'Old & Style', slug: 'old--style' },
  ]
  const id = (name: string) => matchExistingCategory(name, CATS)?.id ?? null

  it('matches by exact name, then by name ignoring case and spaces', () => {
    expect(id('Fan')).toBe('cat-019')
    expect(id(' fan ')).toBe('cat-019')
    expect(id('toys & novelties')).toBe('cat-047')
  })

  it('matches by slug, either the new or the legacy double-dash shape', () => {
    expect(id('Seasonal Holiday')).toBe('cat-064')
    expect(id('LED Electronics')).toBe('cat-036')
    expect(id('Old & Style!')).toBe('cat-099')
  })

  // Before the 2026-10-21 rename these slugs held the category; an old
  // Erply group name must still land there, not come back unmatched.
  it('sends a renamed slug to its successor instead of re-creating it', () => {
    expect(id('Christmas')).toBe('cat-064')
    expect(id('Plush Toys')).toBe('cat-047')
  })

  it('returns null only for a genuinely new name', () => {
    expect(id('Garden Tools')).toBeNull()
    // A renamed slug whose successor is missing is new too, not a crash.
    expect(id('Tumbler')).toBeNull()
  })
})
