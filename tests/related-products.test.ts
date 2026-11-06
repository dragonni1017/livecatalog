import { describe, expect, it } from 'vitest'
import { nameWords, rankRelated } from '@/lib/related-products'

const p = (id: string, name: string, stock = 10, image: string | null = 'https://x/y.jpg') => ({ id, name, stock_qty: stock, image_url: image })

describe('nameWords', () => {
  it('drops the pack spec, sizes, short and common words, and simple plurals', () => {
    expect([...nameWords('Brown Bears Plush with Bow 12" - 12/pk 10bx/cs cs.120')].sort()).toEqual(['bear', 'bow', 'brown', 'plush'])
    expect([...nameWords('Assorted Mini Color Set')]).toEqual([])
  })
})

describe('rankRelated', () => {
  const me = p('me', 'Brown Bear Plush 12" - 12/pk 10bx/cs cs.120')
  it('puts similar names first, then in stock, then with a photo; never the product itself', () => {
    const out = rankRelated(me, [
      p('me', me.name),
      p('a', 'Axolotl Plush', 0, null),
      p('b', 'Brown Bear Keychain Plush', 0),
      p('c', 'Panda Plush', 5),
      p('d', 'Bear Plush Pink', 5),
      p('e', 'Dinosaur Plush', 5, null),
    ])
    expect(out.map((x) => x.id)).toEqual(['d', 'b', 'c', 'e', 'a'])
  })
  it('returns at most n, and is stable for a product but varies between products', () => {
    const pool = Array.from({ length: 30 }, (_, i) => p(`x${i}`, `Thing ${i}`))
    const a1 = rankRelated(p('A', 'Widget'), pool).map((x) => x.id)
    const a2 = rankRelated(p('A', 'Widget'), pool).map((x) => x.id)
    const b = rankRelated(p('B', 'Widget'), pool).map((x) => x.id)
    expect(a1).toHaveLength(6)
    expect(a1).toEqual(a2)
    expect(b).not.toEqual(a1)
  })
})
