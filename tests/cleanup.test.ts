import { describe, it, expect } from 'vitest'
import {
  classifyProduct,
  cleanupNameAudit,
  keepsPackSpec,
  rawCloudinaryPublicId,
  skuCandidatesForPublicId,
} from '../lib/cleanup'

const base = {
  name: 'Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120',
  image_url: 'https://res.cloudinary.com/demo/image/upload/v1/F1.jpg',
  needs_photo: false,
  category_id: 'cat-1',
  description: 'A bear.',
  has_category_link: true,
}

describe('classifyProduct', () => {
  it('flags nothing on a complete product', () => {
    expect(classifyProduct(base)).toEqual({ photo: false, name: false, category: false, description: false })
  })

  it('photo: missing or blank image_url, or needs_photo', () => {
    expect(classifyProduct({ ...base, image_url: null }).photo).toBe(true)
    expect(classifyProduct({ ...base, image_url: '  ' }).photo).toBe(true)
    expect(classifyProduct({ ...base, needs_photo: true }).photo).toBe(true)
    expect(classifyProduct({ ...base, needs_photo: null }).photo).toBe(false)
  })

  it('name: any auditProductName issue', () => {
    expect(classifyProduct({ ...base, name: 'Foam Bear' }).name).toBe(true)
    expect(classifyProduct({ ...base, name: '7491 - Foam Bear - 12/pk 10bx/cs cs.120' }).name).toBe(true)
  })

  it('category: only when there is neither a category_id nor a join row', () => {
    expect(classifyProduct({ ...base, category_id: null, has_category_link: false }).category).toBe(true)
    expect(classifyProduct({ ...base, category_id: null, has_category_link: true }).category).toBe(false)
    expect(classifyProduct({ ...base, category_id: 'c', has_category_link: false }).category).toBe(false)
  })

  it('description: blank after trim', () => {
    expect(classifyProduct({ ...base, description: null }).description).toBe(true)
    expect(classifyProduct({ ...base, description: ' \n ' }).description).toBe(true)
  })
})

describe('keepsPackSpec / cleanupNameAudit', () => {
  it('accepts a cosmetic change that leaves the spec alone', () => {
    expect(keepsPackSpec('Foam  Bear - 12/pk 10bx/cs cs.120', 'Foam Bear - 12/pk 10bx/cs cs.120')).toBe(true)
  })

  it('refuses adding, removing or altering a spec, including its unit', () => {
    expect(keepsPackSpec('Foam Bear', 'Foam Bear - 12/pk 10bx/cs cs.120')).toBe(false)
    expect(keepsPackSpec('Foam Bear - 12/pk 10bx/cs cs.120', 'Foam Bear')).toBe(false)
    expect(keepsPackSpec('Foam Bear - 12/pk 10bx/cs cs.120', 'Foam Bear - 12/pk 10bx/cs cs.10')).toBe(false)
    expect(keepsPackSpec('Lei - 12/pk 25bx/cs cs.25pk', 'Lei - 12/pk 25bx/cs cs.25')).toBe(false)
  })

  it('withholds an audit suggestion that would drop a stated case unit', () => {
    // untidy whitespace is cosmetic, so auditProductName suggests a rebuild --
    // which writes cs.25 without the "pk".
    const name = 'Solid  Lei - 12/pk 25bx/cs cs.25pk'
    expect(cleanupNameAudit(name).suggestion).toBeNull()
  })

  it('passes through a suggestion that keeps the spec', () => {
    const name = 'Foam  Bear - 12/pk 10bx/cs cs.120'
    expect(cleanupNameAudit(name).suggestion).toBe('Foam Bear - 12/pk 10bx/cs cs.120')
  })
})

describe('photo public ids', () => {
  it('maps a view id back to its base SKU', () => {
    expect(skuCandidatesForPublicId('F288094')).toEqual(['F288094'])
    expect(skuCandidatesForPublicId('F288094-2')).toEqual(['F288094-2', 'F288094'])
    expect(skuCandidatesForPublicId('P273814-45cm')).toEqual(['P273814-45cm'])
  })

  it('accepts only raw originals on the configured cloud', () => {
    const cloud = 'demo'
    expect(rawCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/v1727/F288094.jpg', cloud)).toBe('F288094')
    expect(rawCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/F288094-2.png', cloud)).toBe('F288094-2')
    // a baked transform
    expect(rawCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/f_auto,w_800/v1/F1.jpg', cloud)).toBeNull()
    // another cloud, a folder, a query string
    expect(rawCloudinaryPublicId('https://res.cloudinary.com/other/image/upload/v1/F1.jpg', cloud)).toBeNull()
    expect(rawCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/v1/x/F1.jpg', cloud)).toBeNull()
    expect(rawCloudinaryPublicId('https://res.cloudinary.com/demo/image/upload/v1/F1.jpg?x=1', cloud)).toBeNull()
  })
})
