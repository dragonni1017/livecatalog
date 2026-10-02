import type { NextRequest } from 'next/server'

// Best-effort fixed-window limiter, kept in memory per server instance.
// Fluid Compute reuses instances across requests, so this stops a single
// client hammering a public endpoint. It is NOT a global guarantee: separate
// instances keep separate counts. For a hard cap, add a Vercel Firewall
// rate-limit rule on the path as well.

interface Window {
  count: number
  resetAt: number
}

export interface RateLimiter {
  /** true = allowed. false = over the limit for this window. */
  hit(key: string, now?: number): boolean
}

export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000 } = opts
  const windows = new Map<string, Window>()

  return {
    hit(key, now = Date.now()) {
      const w = windows.get(key)
      if (!w || now >= w.resetAt) {
        // Bound memory: when full, drop expired windows first, and if still
        // full, the oldest entry (Map keeps insertion order).
        if (!w && windows.size >= maxKeys) {
          for (const [k, v] of windows) if (now >= v.resetAt) windows.delete(k)
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value as string)
        }
        windows.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }
      w.count++
      return w.count <= limit
    },
  }
}

/** The caller's IP as Vercel reports it, or 'unknown'. */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown'
}
