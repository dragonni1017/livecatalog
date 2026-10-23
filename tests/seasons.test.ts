import { describe, expect, it } from 'vitest'
import { compareBySeason, easterSunday, seasonOf } from '../lib/seasons'

const oct23 = new Date('2026-10-23T15:00:00Z')

describe('seasonOf', () => {
  it('reads the holiday from real unpriced product names', () => {
    const key = (name: string) => seasonOf(name, oct23)?.key ?? null
    expect(key('Black Halloween Paper - 20/pk 60bx/cs cs.60')).toBe('halloween')
    expect(key('Small Pumpkin Squish Toy - 72/pk 1bx/cs cs.72')).toBe('halloween')
    expect(key('40oz X-mas Highland Cow Tumbler - 20/pk 1bx/cs cs.20')).toBe('christmas')
    expect(key('40oz Grinch Tumblers - 20/pk 1bx/cs cs.20')).toBe('christmas')
    expect(key('Dark Orange Fall Theme Paper - 20/pk 60bx/cs cs.60')).toBe('thanksgiving')
    expect(key('Best MOM Ever Tumbler - 1/pk 20bx/cs cs.20')).toBe('mothers-day')
    expect(key('40oz Grad Cup - 1/pk 20bx/cs cs.20')).toBe('graduation')
    expect(key('USA Tumbler - 1/pk 20bx/cs cs.20')).toBe('july-4')
  })

  // These sell all year; matching them would bury the real seasonal work.
  it('leaves year-round names alone', () => {
    for (const name of [
      'Shark Skeleton Plush 90cm - 24/cs',
      'Heart Shaped Flower Holder - 40/pk 1bx/cs cs.40',
      'Bunny 4color Keychain - 12/pk 20bx/cs cs.240',
      'Black Sunflower Paper - 20/pk 60bx/cs cs.60',
      'Foldable Box 2-pc Set - 1/pk 36bx/cs cs.36',
    ]) {
      expect(seasonOf(name, oct23)).toBeNull()
    }
  })

  it('counts whole days to the next holiday', () => {
    expect(seasonOf('Halloween Paper', oct23)).toMatchObject({ daysLeft: 8, over: false })
    expect(seasonOf('Thanksgiving Decoration', oct23)).toMatchObject({ daysLeft: 34, over: false }) // Nov 26
    expect(seasonOf('Christmas Tree', oct23)).toMatchObject({ daysLeft: 63, over: false })
    expect(seasonOf('Halloween Paper', new Date('2026-10-31T23:59:00Z'))).toMatchObject({ daysLeft: 0, over: false })
  })

  it('marks a season that just passed as over, then rolls to next year', () => {
    expect(seasonOf('Halloween Paper', new Date('2026-11-01T00:00:00Z'))).toMatchObject({ daysLeft: 364, over: true })
    expect(seasonOf('Halloween Paper', new Date('2027-01-15T00:00:00Z'))).toMatchObject({ over: false })
    // The year wrap: Christmas 2026 is over on Jan 5 2027.
    expect(seasonOf('Christmas Tree', new Date('2027-01-05T00:00:00Z'))).toMatchObject({ over: true })
  })
})

describe('easterSunday', () => {
  it('matches known dates', () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05')
    expect(easterSunday(2027).toISOString().slice(0, 10)).toBe('2027-03-28')
  })
})

describe('compareBySeason', () => {
  it('puts the closest holiday first, year-round next, just-ended last', () => {
    const names = [
      'Ribbon',
      'Christmas Tree',
      'Grad Cup',
      'Halloween Paper',
      'Thanksgiving Decoration',
    ]
    const sorted = [...names].sort((a, b) => compareBySeason(seasonOf(a, oct23), seasonOf(b, oct23)))
    // Graduation is 221 days out: no rush yet, so it sorts with the year-round
    // products and keeps their original order.
    expect(sorted).toEqual(['Halloween Paper', 'Thanksgiving Decoration', 'Christmas Tree', 'Ribbon', 'Grad Cup'])

    const nov2 = new Date('2026-11-02T00:00:00Z')
    expect(
      [...names].sort((a, b) => compareBySeason(seasonOf(a, nov2), seasonOf(b, nov2))).at(-1),
    ).toBe('Halloween Paper')
  })
})
