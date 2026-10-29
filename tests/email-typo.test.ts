import { describe, it, expect } from 'vitest'
import { editDistance, suggestEmailFix } from '@/lib/email-typo'

describe('suggestEmailFix', () => {
  it('fixes the three domains seen on real orders', () => {
    expect(suggestEmailFix('someone@gmai.com')).toBe('someone@gmail.com')
    expect(suggestEmailFix('someone@gmail.ocm')).toBe('someone@gmail.com')
    expect(suggestEmailFix('someone@ioud.com')).toBe('someone@icloud.com')
  })

  it('fixes other common slips', () => {
    expect(suggestEmailFix('a@gmial.com')).toBe('a@gmail.com')
    expect(suggestEmailFix('a@hotmial.com')).toBe('a@hotmail.com')
    expect(suggestEmailFix('a@yahoo.con')).toBe('a@yahoo.com')
    expect(suggestEmailFix('a@yaho.com')).toBe('a@yahoo.com')
    expect(suggestEmailFix('a@outlok.com')).toBe('a@outlook.com')
    expect(suggestEmailFix('A.B@GMAIL.CMO')).toBe('A.B@gmail.com')
  })

  it('leaves correct and uncommon real domains alone', () => {
    expect(suggestEmailFix('a@gmail.com')).toBeNull()
    expect(suggestEmailFix('a@ly-usa.com')).toBeNull()
    expect(suggestEmailFix('a@blackfoot.net')).toBeNull()
    expect(suggestEmailFix('a@amwny.com')).toBeNull()
    expect(suggestEmailFix('a@mac.com')).toBeNull()
    expect(suggestEmailFix('a@gmx.com')).toBeNull()
    expect(suggestEmailFix('a@myyahoo.com')).toBeNull() // Yahoo's own domain
    expect(suggestEmailFix('a@cox.net')).toBeNull()
    expect(suggestEmailFix('a@att.com')).toBeNull()
  })

  it('ignores input that is not an email yet', () => {
    expect(suggestEmailFix('')).toBeNull()
    expect(suggestEmailFix('abc')).toBeNull()
    expect(suggestEmailFix('@gmai.com')).toBeNull()
    expect(suggestEmailFix('a@')).toBeNull()
  })
})

describe('editDistance', () => {
  it('counts single edits and caps early', () => {
    expect(editDistance('gmai.com', 'gmail.com')).toBe(1)
    expect(editDistance('abc', 'abc')).toBe(0)
    expect(editDistance('a', 'abcdefgh', 2)).toBe(3)
  })
})
