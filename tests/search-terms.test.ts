import { describe, expect, it } from 'vitest'
import { buildVocabulary, closestWord, searchVariants, searchWords, suggestSearch, wordOrFilter } from '@/lib/search-terms'

describe('searchWords', () => {
  it('splits and strips PostgREST filter chars', () => {
    expect(searchWords('  red (big),pens%  ')).toEqual(['red', 'bigpens'])
    expect(searchWords(undefined)).toEqual([])
    expect(searchWords('%,')).toEqual([])
  })
})

describe('searchVariants', () => {
  it('adds singular forms', () => {
    expect(searchVariants('speakers')).toContain('speaker')
    expect(searchVariants('bunnies')).toContain('bunny')
    expect(searchVariants('cookies')).toContain('cookie')
    expect(searchVariants('boxes')).toContain('box')
    expect(searchVariants('glasses')).toContain('glass')
    expect(searchVariants('brushes')).toContain('brush')
    expect(searchVariants('Squishies')).toContain('squishy')
  })
  it('adds -ies for a consonant + y word', () => {
    expect(searchVariants('bunny')).toContain('bunnie')
    expect(searchVariants('toy')).toEqual(['toy'])
  })
  it('leaves -ss words and short words alone', () => {
    expect(searchVariants('glass')).toEqual(['glass'])
    expect(searchVariants('bus')).toEqual(['bus'])
  })
})

describe('wordOrFilter', () => {
  it('ORs every variant across every field', () => {
    expect(wordOrFilter('pens', ['name', 'sku'])).toBe('name.ilike.%pens%,sku.ilike.%pens%,name.ilike.%pen%,sku.ilike.%pen%')
  })
})

const vocab = buildVocabulary([
  'Squishy Bunny - 12/pk',
  'Squishy Cat',
  'Stationery Set, Floral',
  'Fidget Spinner',
  'Fidget Popper',
  'Bluetooth Speaker',
])

describe('closestWord', () => {
  it('fixes one-letter typos', () => {
    expect(closestWord('swuishy', vocab)).toBe('squishy')
    expect(closestWord('stationary', vocab)).toBe('stationery')
    expect(closestWord('fidgt', vocab)).toBe('fidget')
  })
  it('skips short, numeric, far-off, and different-first-letter words', () => {
    expect(closestWord('cst', vocab)).toBeNull()
    expect(closestWord('fidt', vocab)).toBeNull()
    expect(closestWord('aquishy', vocab)).toBeNull()
    expect(closestWord('k2295', vocab)).toBeNull()
    expect(closestWord('umbrella', vocab)).toBeNull()
  })
})

describe('suggestSearch', () => {
  it('corrects only the misspelled words', () => {
    expect(suggestSearch('floral statoinery', vocab)).toBe('floral stationery')
    // A synonym-handled word is left alone: the search itself finds it now.
    expect(suggestSearch('floral stationary', vocab)).toBeNull()
    expect(suggestSearch('squiishy bunny', vocab)).toBe('squishy bunny')
  })
  it('fixes a misspelled plural via its singular', () => {
    expect(suggestSearch('fidgts', vocab)).toBe('fidget')
  })
  it('returns null when nothing needs fixing or a word cannot be fixed', () => {
    expect(suggestSearch('squishy', vocab)).toBeNull()
    expect(suggestSearch('speakers', vocab)).toBeNull()
    expect(suggestSearch('sqishy umbrella', vocab)).toBeNull()
    expect(suggestSearch('', vocab)).toBeNull()
  })
})

describe('synonyms and category words', async () => {
  const { searchTerms, categoryIdsFor, SEARCH_SYNONYMS } = await import('@/lib/search-terms')
  const cats = [
    { id: 'cat-001', name: 'Stationery & Office' },
    { id: 'cat-002', name: 'Floral Supplies' },
    { id: 'cat-003', name: 'Drinkware & Cups' },
    { id: 'cat-004', name: 'LED' },
  ]
  it('adds synonyms (and their plurals) to the word', () => {
    expect(searchTerms('journals')).toEqual(expect.arrayContaining(['journals', 'journal', 'notebook']))
    expect(searchTerms('pipecleaners')).toContain('chenille')
    expect(searchTerms('Peluches')).toContain('plush')
    expect(searchTerms('speakers')).toEqual(['speakers', 'speaker'])
  })
  it('matches category names by whole word, never on short terms', () => {
    expect(categoryIdsFor('stationary', cats)).toEqual(['cat-001'])
    expect(categoryIdsFor('supplies', cats)).toEqual(['cat-002'])
    expect(categoryIdsFor('cup', cats)).toEqual([]) // 3 letters
    expect(categoryIdsFor('cups', cats)).toEqual(['cat-003'])
    expect(categoryIdsFor('led', cats)).toEqual([])
    expect(categoryIdsFor('bear', cats)).toEqual([])
  })
  it('adds a category clause only when categories are given', () => {
    expect(wordOrFilter('stationary', ['name'], cats)).toBe('name.ilike.%stationary%,name.ilike.%stationery%,name.ilike.%stationerie%,name.ilike.%stationarie%,category_id.in.(cat-001)')
    expect(wordOrFilter('stationary', ['name'])).not.toContain('category_id')
    expect(wordOrFilter('x', ['name'], [{ id: 'bad,id', name: 'Xylo' }])).toBe('name.ilike.%x%')
  })
  it('keeps every synonym filter-safe (single lowercase word)', () => {
    for (const [k, vs] of Object.entries(SEARCH_SYNONYMS)) {
      expect(k).toMatch(/^[a-z]+$/)
      for (const v of vs) expect(v).toMatch(/^[a-z]+$/)
    }
  })
})
