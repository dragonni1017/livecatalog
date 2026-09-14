import { describe, it, expect } from 'vitest'
import { binCapacity, binsNeededForCases, fitByVolume } from '@/lib/bin-capacity'

// All dimensions are inches, weights pounds — see lib/bin-capacity.ts.
const bin = (length_in: number, width_in: number, height_in: number, max_weight_lb: number | null = null) => ({
  length_in,
  width_in,
  height_in,
  max_weight_lb,
})

const carton = (
  case_length_in: number,
  case_width_in: number,
  case_height_in: number,
  case_weight_lb: number | null = null,
) => ({ case_length_in, case_width_in, case_height_in, case_weight_lb })

describe('fitByVolume', () => {
  it('counts a perfect grid with no waste', () => {
    // 24x18x12 bin, 6x6x6 case -> 4 x 3 x 2
    expect(fitByVolume(bin(24, 18, 12), carton(6, 6, 6)).cases).toBe(24)
  })

  it('charges for dead space instead of dividing volumes', () => {
    // The case this module exists for: volume division gives
    // (24*18*12) / 1000 = 5.18 -> 5. Only 2 actually fit (2 x 1 x 1).
    expect(fitByVolume(bin(24, 18, 12), carton(10, 10, 10)).cases).toBe(2)
  })

  it('rotates the case to fit when one orientation fails', () => {
    // 10x10x30 bin, 30x5x5 case: fits only with the long edge vertical.
    const { cases, orientation } = fitByVolume(bin(10, 10, 30), carton(30, 5, 5))
    expect(cases).toBe(4)
    expect(orientation).toEqual([5, 5, 30])
  })

  it('returns 0 when the case is larger in every orientation', () => {
    expect(fitByVolume(bin(10, 10, 10), carton(11, 11, 11)).cases).toBe(0)
  })

  it('handles a case that fits exactly once', () => {
    expect(fitByVolume(bin(12, 12, 12), carton(12, 12, 12)).cases).toBe(1)
  })

  it('treats a missing dimension as no answer rather than a huge one', () => {
    expect(fitByVolume(bin(24, 18, 12), { ...carton(6, 6, 6), case_height_in: null }).cases).toBe(0)
    expect(fitByVolume({ ...bin(24, 18, 12), width_in: null }, carton(6, 6, 6)).cases).toBe(0)
  })

  it('ignores zero and negative values, which mean "not measured" upstream', () => {
    expect(fitByVolume(bin(24, 18, 12), { ...carton(6, 6, 6), case_length_in: 0 }).cases).toBe(0)
    expect(fitByVolume(bin(24, 18, 12), { ...carton(6, 6, 6), case_length_in: -6 }).cases).toBe(0)
  })
})

describe('binCapacity', () => {
  it('reports space as the binding constraint when weight is slack', () => {
    const out = binCapacity(bin(24, 18, 12, 2000), carton(6, 6, 6, 10))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.cases).toBe(24)
    expect(out.result.casesByVolume).toBe(24)
    expect(out.result.casesByWeight).toBe(200)
    expect(out.result.binding).toBe('volume')
    expect(out.result.loadedWeightLb).toBe(240)
  })

  it('reports the weight limit when it bites first', () => {
    // 24 fit by space, but a 100 lb case against a 500 lb shelf allows 5.
    const out = binCapacity(bin(24, 18, 12, 500), carton(6, 6, 6, 100))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.casesByVolume).toBe(24)
    expect(out.result.casesByWeight).toBe(5)
    expect(out.result.cases).toBe(5)
    expect(out.result.binding).toBe('weight')
    expect(out.result.loadedWeightLb).toBe(500)
  })

  it('reports both when the two limits coincide', () => {
    const out = binCapacity(bin(24, 18, 12, 240), carton(6, 6, 6, 10))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.binding).toBe('both')
    expect(out.result.cases).toBe(24)
  })

  it('does not let an unknown weight limit constrain anything', () => {
    const out = binCapacity(bin(24, 18, 12, null), carton(6, 6, 6, 10))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // null, not Infinity and not 0 — "nobody recorded a rating".
    expect(out.result.casesByWeight).toBeNull()
    expect(out.result.cases).toBe(24)
    expect(out.result.binding).toBe('volume')
  })

  it('does not let an unknown case weight constrain anything', () => {
    const out = binCapacity(bin(24, 18, 12, 500), carton(6, 6, 6, null))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.casesByWeight).toBeNull()
    expect(out.result.cases).toBe(24)
    expect(out.result.loadedWeightLb).toBeNull()
  })

  it('says does-not-fit when the case is too big', () => {
    const out = binCapacity(bin(10, 10, 10, 500), carton(11, 11, 11, 5))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.cases).toBe(0)
    expect(out.result.binding).toBe('does-not-fit')
  })

  it('says does-not-fit when one case alone busts the weight limit', () => {
    const out = binCapacity(bin(24, 18, 12, 50), carton(6, 6, 6, 80))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.casesByWeight).toBe(0)
    expect(out.result.cases).toBe(0)
    expect(out.result.binding).toBe('does-not-fit')
  })

  it('distinguishes unmeasured inputs from a genuine zero', () => {
    // The distinction that stops the UI printing "0 cases fit" when the real
    // answer is "nobody has measured this".
    const noBin = binCapacity({ length_in: null, width_in: null, height_in: null }, carton(6, 6, 6, 10))
    expect(noBin.ok).toBe(false)
    if (noBin.ok) return
    expect(noBin.missing).toBe('bin-dimensions')

    const noCarton = binCapacity(bin(24, 18, 12, 500), {
      case_length_in: null,
      case_width_in: null,
      case_height_in: null,
      case_weight_lb: 10,
    })
    expect(noCarton.ok).toBe(false)
    if (noCarton.ok) return
    expect(noCarton.missing).toBe('carton-dimensions')
  })

  it('checks the bin before the carton, so an unmeasured bin is named first', () => {
    const out = binCapacity({ length_in: null, width_in: null, height_in: null }, {
      case_length_in: null,
      case_width_in: null,
      case_height_in: null,
    })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.missing).toBe('bin-dimensions')
  })

  it('computes utilisation against the bin interior', () => {
    // Perfect fit -> 100%.
    const exact = binCapacity(bin(24, 18, 12), carton(6, 6, 6))
    expect(exact.ok).toBe(true)
    if (!exact.ok) return
    expect(exact.result.volumeUtilisation).toBeCloseTo(1, 5)

    // 2 of 10x10x10 in 24x18x12 = 2000 / 5184.
    const wasteful = binCapacity(bin(24, 18, 12), carton(10, 10, 10))
    expect(wasteful.ok).toBe(true)
    if (!wasteful.ok) return
    expect(wasteful.result.volumeUtilisation).toBeCloseTo(2000 / 5184, 5)
  })

  it('works on real catalog numbers', () => {
    // D701081 "Diamond Pin - 48/pk 10bx/cs cs.480": 23 x 14 x 11 in, 30 lb
    // (from the 2026-09-11 Erply backfill), in a 96x48x24 pallet-ish bay
    // rated 2,000 lb.
    const out = binCapacity(bin(96, 48, 24, 2000), carton(23, 14, 11, 30))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // By space: laid out 23 along the 96, 14 across the 48, 11 up the 24 ->
    // floor(96/23)=4 x floor(48/14)=3 x floor(24/11)=2 = 24. Several
    // orientations tie at 24 here; the first one found wins.
    expect(out.result.casesByVolume).toBe(24)
    expect(out.result.orientation).toEqual([23, 14, 11])
    // By weight: floor(2000 / 30) = 66, so space is what runs out.
    expect(out.result.casesByWeight).toBe(66)
    expect(out.result.cases).toBe(24)
    expect(out.result.binding).toBe('volume')
    expect(out.result.loadedWeightLb).toBe(720)
  })
})

describe('binsNeededForCases', () => {
  it('rounds up to whole bins', () => {
    // 24 per bin, 100 cases -> 5 bins.
    expect(binsNeededForCases(bin(24, 18, 12), carton(6, 6, 6), 100)).toBe(5)
  })

  it('needs one bin for a partial load', () => {
    expect(binsNeededForCases(bin(24, 18, 12), carton(6, 6, 6), 1)).toBe(1)
  })

  it('needs no bins for nothing', () => {
    expect(binsNeededForCases(bin(24, 18, 12), carton(6, 6, 6), 0)).toBe(0)
  })

  it('returns null when the case will never fit, rather than Infinity', () => {
    expect(binsNeededForCases(bin(10, 10, 10), carton(11, 11, 11), 50)).toBeNull()
  })

  it('returns null when the bin is unmeasured', () => {
    expect(
      binsNeededForCases({ length_in: null, width_in: null, height_in: null }, carton(6, 6, 6), 50),
    ).toBeNull()
  })
})
