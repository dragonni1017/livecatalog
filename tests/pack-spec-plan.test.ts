import { describe, expect, it } from 'vitest'
import { nameHead, planPackSpecName } from '../lib/pack-spec-plan'

// Examples are real catalog names and QuickBooks descriptions (2026-10-26).

describe('nameHead', () => {
  it('drops an empty spec template and a bare QuickBooks count', () => {
    expect(nameHead('Dynasty Dragon 11 - /pk bx/cs cs.')).toBe('Dynasty Dragon 11')
    expect(nameHead('SeaCreature Keychain - 240/cs')).toBe('SeaCreature Keychain')
    expect(nameHead('40oz X-mas Tumblers - 20/cs')).toBe('40oz X-mas Tumblers')
  })

  it('leaves everything else, including sizes and "Style", untouched', () => {
    expect(nameHead('Glitter White Ribbon 1.5"')).toBe('Glitter White Ribbon 1.5"')
    expect(nameHead('Christmas 4 Style Keychain')).toBe('Christmas 4 Style Keychain')
  })
})

describe('planPackSpecName', () => {
  it('uses figures QuickBooks states in full', () => {
    const p = planPackSpecName({ sku: 'S121034-G', name: 'Glow in the dark Dumping', qbDesc: 'Glow in the dark Dumping - 12/bx - 6bx/cs - 72/cs' })
    expect(p).toMatchObject({ status: 'propose', rule: 'qb-stated', to: 'Glow in the dark Dumping - 12/pk 6bx/cs cs.72' })
  })

  it('derives boxes from N/pk and M/cs, marked verify', () => {
    const p = planPackSpecName({ sku: 'T641666', name: '13" 3D Printed Winged Dragon', qbDesc: '13" 3D Printed Winged Dragon - 12/pk - 108 /cs - 23" x 16" x 11" - 15 lbs' })
    expect(p).toMatchObject({ status: 'propose', rule: 'qb-derived', to: '13" 3D Printed Winged Dragon - 12/pk 9bx/cs cs.108' })
    expect(p.why).toMatch(/^VERIFY/)
  })

  it('applies the approved plush rule to a bare N/cs', () => {
    const p = planPackSpecName({ sku: 'P273842', name: 'Purple Octopus Companion Plush', qbDesc: 'Purple Octopus Companion Plush - 18/cs - 25" x 18" x 23" - 28lbs' })
    expect(p).toMatchObject({ status: 'propose', rule: 'plush-1pk', to: 'Purple Octopus Companion Plush - 1/pk 18bx/cs cs.18' })
  })

  it('applies the tumbler rule and replaces the bare count in the name', () => {
    const p = planPackSpecName({ sku: 'T642288', name: '40oz X-mas Tumblers - 20/cs', qbDesc: '40oz X-mas Tumblers - 20/cs - 27" x 24" x 13" - 29lbs' })
    expect(p).toMatchObject({ status: 'propose', rule: 'tumbler-1pk', to: '40oz X-mas Tumblers - 1/pk 20bx/cs cs.20' })
  })

  it('applies the keychain 12/pk rule only in its range', () => {
    expect(planPackSpecName({ sku: 'K229512', name: 'Bear Bedazzled Keychain', qbDesc: 'Bear Bedazzled Keychain - 240pc/cs - 20" x 16" x 16" -  25lbs' }))
      .toMatchObject({ status: 'propose', rule: 'keychain-12pk', to: 'Bear Bedazzled Keychain - 12/pk 20bx/cs cs.240' })
    expect(planPackSpecName({ sku: 'K229581', name: 'SeaCreature Keychain - 240/cs', qbDesc: 'SeaCreature Keychain - 240/cs - 12" x 8" x 12" - 17lbs' }).status)
      .toBe('needs_person')
    expect(planPackSpecName({ sku: 'K229497', name: 'Keychain', qbDesc: 'Keychain - 240/cs' }).status).toBe('needs_person')
  })

  it('applies a SKU-range rule only when the product says what it is', () => {
    // T6422xx also holds leather patches, fans, a pill box.
    expect(planPackSpecName({ sku: 'T642279', name: 'Bedazzled Pill Box', qbDesc: 'Bedazzled Pill Box - 480/cs' }).status).toBe('needs_person')
    expect(planPackSpecName({ sku: 'T642233', name: 'Butterfly Leather Patch', qbDesc: 'Butterfly Leather Patch - 240/cs' }).status).toBe('needs_person')
    // K2295xx also holds a bag/wallet.
    expect(planPackSpecName({ sku: 'K229517', name: 'Heart Style Bag/wallet', qbDesc: 'Heart Style Bag/wallet - 120/cs - 20" x 16" x 10" - 33lbs' }).status).toBe('needs_person')
    // A keychain by its QuickBooks category still counts.
    expect(planPackSpecName({ sku: 'K229510', name: 'Three-colo Smiling Cow', qbDesc: 'Three-colo Smiling Cow - 240pc/cs', qbFullName: 'Keychains:K229510' }).rule).toBe('keychain-12pk')
  })

  it('never makes a K-series plush 1/pk', () => {
    const p = planPackSpecName({ sku: 'K229521', name: '8CM Plush Dumplings', qbDesc: '8CM Plush Dumplings - 240/cs' })
    expect(p.status).toBe('needs_person')
  })

  it('never infers a pack for anything else with only a case total', () => {
    const squish = planPackSpecName({ sku: 'S162807', name: 'Banana Squishy Toy', qbDesc: 'Banana Squishy Toy - 24/cs - 23" x 17" x 11"  - 35lbs' })
    expect(squish).toMatchObject({ status: 'needs_person', to: null })
    expect(squish.why).toMatch(/only 24\/cs/)
    const snake = planPackSpecName({ sku: '3D801219', name: '3D Printed Snakes 30cm', qbDesc: '3D Printed Snakes 30cm - 216/cs - 32" x 15" x 21" - 27lbs' })
    expect(snake.status).toBe('needs_person')
  })

  it('does not apply the plush rule to a plush accessory', () => {
    const p = planPackSpecName({ sku: 'K229492', name: 'Rabbit Keychain Plush', qbDesc: 'Rabbit Keychain Plush - 240/cs' })
    // Keychain range applies instead; the plush rule must not make it 1/pk.
    expect(p.rule).toBe('keychain-12pk')
  })

  it('leaves a product with no QuickBooks counts, or no QuickBooks item, for a person', () => {
    expect(planPackSpecName({ sku: 'F282035', name: 'Fur Heart Cross Body Purse - /pk bx/cs cs.', qbDesc: 'Fur Heart Cross Body Purse' }))
      .toMatchObject({ status: 'needs_person', why: 'QuickBooks states no pack figures: needs counting' })
    expect(planPackSpecName({ sku: 'X1', name: 'Thing', qbDesc: null }).why).toMatch(/not in the QuickBooks/)
  })
})
