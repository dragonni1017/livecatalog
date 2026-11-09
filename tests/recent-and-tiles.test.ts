import { describe, expect, it } from 'vitest'
import { addRecent, parseRecent, RECENT_MAX } from '@/lib/recently-viewed'
import { departmentPhotos } from '@/lib/category-groups'

const item = (id: string) => ({ id, name: `Product ${id}`, image_url: `https://x/${id}.jpg` })

describe('recently viewed', () => {
  it('puts the newest first without duplicates, capped', () => {
    let list = [item('a'), item('b')]
    list = addRecent(list, item('b'))
    expect(list.map((x) => x.id)).toEqual(['b', 'a'])
    for (let i = 0; i < 20; i++) list = addRecent(list, item(`p${i}`))
    expect(list).toHaveLength(RECENT_MAX)
    expect(list[0].id).toBe('p19')
  })
  it('reads only well-formed entries, and [] for anything else', () => {
    expect(parseRecent(JSON.stringify([item('a'), { id: 5 }, { id: 'b', name: 'B' }, null]))).toEqual([item('a'), { id: 'b', name: 'B', image_url: null }])
    expect(parseRecent('not json')).toEqual([])
    expect(parseRecent('{"id":"a"}')).toEqual([])
    expect(parseRecent(null)).toEqual([])
  })
})

describe('departmentPhotos', () => {
  const cats = [
    { id: 'c1', name: 'Papers', slug: 'papers' },
    { id: 'c2', name: 'Plush', slug: 'plush' },
  ]
  it('picks the in-stock product with a real photo and the most stock per department', () => {
    const photos = departmentPhotos(
      [
        { id: 'p1', category_id: 'c1', image_url: 'https://x/p1.jpg', needs_photo: false, stock_qty: 50 },
        { id: 'p2', category_id: 'c1', image_url: 'https://x/p2.jpg', needs_photo: false, stock_qty: 900 },
        { id: 'p3', category_id: 'c1', image_url: 'https://x/p3.jpg', needs_photo: true, stock_qty: 9999 }, // flagged photo
        { id: 'p4', category_id: 'c2', image_url: null, needs_photo: false, stock_qty: 9999 }, // no photo
        { id: 'p5', category_id: 'c2', image_url: 'https://x/p5.jpg', needs_photo: false, stock_qty: 0 }, // out of stock
        { id: 'p6', category_id: 'c2', image_url: 'https://x/p6.jpg', needs_photo: false, stock_qty: 3 },
      ],
      cats,
    )
    expect(photos).toEqual({ 'Florals & Gifts': 'https://x/p2.jpg', Toys: 'https://x/p6.jpg' })
  })
})
