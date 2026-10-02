import { describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { clientIp, createRateLimiter } from '../lib/rate-limit'

describe('createRateLimiter', () => {
  it('allows up to the limit per window, then blocks until it resets', () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 })
    const t = 1_000_000
    expect([rl.hit('a', t), rl.hit('a', t + 1), rl.hit('a', t + 2)]).toEqual([true, true, true])
    expect(rl.hit('a', t + 3)).toBe(false)
    expect(rl.hit('a', t + 999)).toBe(false)
    expect(rl.hit('a', t + 1000)).toBe(true)
  })

  it('counts each key separately', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 })
    expect(rl.hit('a', 0)).toBe(true)
    expect(rl.hit('a', 1)).toBe(false)
    expect(rl.hit('b', 1)).toBe(true)
  })

  it('stays bounded in memory under many distinct keys', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 })
    for (let i = 0; i < 10_000; i++) rl.hit(`ip-${i}`, 0)
    // The newest key is still tracked, so its second hit is blocked.
    expect(rl.hit('ip-9999', 1)).toBe(false)
  })
})

describe('clientIp', () => {
  const req = (h: Record<string, string>) => new Request('https://x/api/track', { headers: h }) as unknown as NextRequest
  it('takes the first x-forwarded-for hop, then x-real-ip, then unknown', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }))).toBe('203.0.113.5')
    expect(clientIp(req({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7')
    expect(clientIp(req({}))).toBe('unknown')
  })
})
