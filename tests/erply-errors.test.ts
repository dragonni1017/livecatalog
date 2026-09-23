import { describe, expect, it } from 'vitest'

import { ErplyApiError } from '@/lib/erply'

// Erply answers a failure with a number and the name of the parameter it
// objected to, never a sentence. These assert the translation, because the
// raw pair ("Erply error 1012: code2") reads like an error numbered 2 and
// sent a warehouse looking in the wrong place.
describe('ErplyApiError', () => {
  it('names the barcode, not "code2"', () => {
    const err = new ErplyApiError(1012, 'code2', '737879111611')
    expect(err.message).toContain('barcode')
    expect(err.message).toContain('737879111611')
    expect(err.message).toContain('unique')
    // "code2" may appear only inside the trailing [Erply 1012/code2] tag,
    // never in the sentence a human reads.
    const sentence = err.message.split('[Erply')[0]
    expect(sentence).not.toContain('code2')
  })

  it('names the SKU, not "code"', () => {
    const err = new ErplyApiError(1012, 'code', 'F288089')
    expect(err.message).toContain('SKU')
    expect(err.message).toContain('F288089')
  })

  it('keeps the raw code and field on the end so logs stay searchable', () => {
    expect(new ErplyApiError(1012, 'code2', '123').message).toContain('[Erply 1012/code2]')
    expect(new ErplyApiError(1010, 'name', null).message).toContain('[Erply 1010/name]')
  })

  it('exposes the parts for callers that need to branch', () => {
    const err = new ErplyApiError(1012, 'code2', '737879111611')
    expect(err.errorCode).toBe(1012)
    expect(err.errorField).toBe('code2')
    expect(err.rejectedValue).toBe('737879111611')
    expect(err).toBeInstanceOf(Error)
  })

  it('translates the other codes this API actually returns', () => {
    expect(new ErplyApiError(1010, 'groupID', null).message).toContain('none was sent')
    expect(new ErplyApiError(1011, 'groupID', '999').message).toContain('no such item')
    expect(new ErplyApiError(1014, 'price', 'abc').message).toContain('format')
  })

  it('falls back to something searchable for a code it has never seen', () => {
    const err = new ErplyApiError(1234, 'mystery', 'x')
    expect(err.message).toContain('error 1234')
    expect(err.message).toContain('[Erply 1234/mystery]')
  })

  it('copes with no errorField at all', () => {
    const err = new ErplyApiError(1013, null, null)
    expect(err.message).toContain('inconsistent')
    expect(err.message).toContain('[Erply 1013]')
    expect(err.errorField).toBeNull()
  })
})
