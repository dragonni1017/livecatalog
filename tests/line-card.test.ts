import { describe, expect, it } from 'vitest'
import { MAX_LINE_CARD_SKUS, parseSkuList, splitPackSpec } from '../lib/line-card'

describe('splitPackSpec', () => {
  it('splits the pack spec off the last " - "', () => {
    expect(splitPackSpec('Moonrise Floral Paper Burgundy - 20/pk 60bx/cs cs.60')).toEqual({
      title: 'Moonrise Floral Paper Burgundy',
      spec: '20/pk 60bx/cs cs.60',
    })
  })
  it('only splits at the LAST dash, so dashes inside the name survive', () => {
    expect(splitPackSpec('3-in-1 Bow - Gold - 12/pk 10bx/cs cs.120')).toEqual({
      title: '3-in-1 Bow - Gold',
      spec: '12/pk 10bx/cs cs.120',
    })
  })
  it('recognises a spec with a unit suffix like cs.50pk', () => {
    expect(splitPackSpec('Happy Face Pen - 12/pk 50bx/cs cs.50pk').spec).toBe('12/pk 50bx/cs cs.50pk')
  })
  it('leaves a name alone when the tail is not a pack spec', () => {
    expect(splitPackSpec('Floral Paper - Pink')).toEqual({ title: 'Floral Paper - Pink', spec: null })
    expect(splitPackSpec('Plain name')).toEqual({ title: 'Plain name', spec: null })
  })
  it('does not split a name that starts with the separator', () => {
    expect(splitPackSpec(' - 20/pk 1bx/cs cs.20').spec).toBeNull()
  })
})

describe('parseSkuList', () => {
  it('splits on commas, semicolons, spaces and newlines', () => {
    expect(parseSkuList('F1, F2;F3\nF4\t F5')).toEqual(['F1', 'F2', 'F3', 'F4', 'F5'])
  })
  it('dedupes case-insensitively and keeps the first spelling and order', () => {
    expect(parseSkuList('f287957 F287984 F287957 f287984')).toEqual(['f287957', 'F287984'])
  })
  it('ignores empty input', () => {
    expect(parseSkuList('')).toEqual([])
    expect(parseSkuList(' ,, \n ')).toEqual([])
  })
  it(`caps the list at ${MAX_LINE_CARD_SKUS}`, () => {
    const raw = Array.from({ length: MAX_LINE_CARD_SKUS + 50 }, (_, i) => `S${i}`).join(',')
    const out = parseSkuList(raw)
    expect(out).toHaveLength(MAX_LINE_CARD_SKUS)
    expect(out[0]).toBe('S0')
  })
})
