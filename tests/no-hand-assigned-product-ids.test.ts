import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

// products.id comes from products_id_seq (migrations 0020 / 0052). Code that
// builds a "prod-NNNNN" id itself pushes the sequence out of step, and the
// next default-id insert anywhere then fails on products_pkey (2026-09-23,
// and again 2026-11-25 from the Receiving "Add to catalog" route).
const ROOTS = ['app', 'lib', 'components']
const HAND_ASSIGNED = /`prod-\$\{|['"]prod-['"]\s*\+/

function* files(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* files(p)
    else if (/\.(ts|tsx|mjs)$/.test(e.name)) yield p
  }
}

describe('product ids', () => {
  it('are never built by hand in app, lib or components', () => {
    const offenders = ROOTS.flatMap((r) => [...files(r)]).filter((f) => HAND_ASSIGNED.test(fs.readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
