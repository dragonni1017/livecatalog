import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { DAILY, ROLES, WORKFLOWS } from '@/lib/admin-guide'

// The guide is what staff are trained from, so a link to a screen that was
// renamed or removed is a broken instruction, not just a 404.

const ROOT = path.resolve(__dirname, '..')

function pageExists(href: string): boolean {
  const pathname = href.split(/[?#]/)[0]
  return fs.existsSync(path.join(ROOT, 'app', ...pathname.split('/').filter(Boolean), 'page.tsx'))
}

const links = [
  ...DAILY.map((s) => s.href),
  ...WORKFLOWS.flatMap((w) => w.steps.map((s) => s.href)),
  ...ROLES.flatMap((r) => r.tasks.map((t) => t.href)),
].filter((h): h is string => Boolean(h))

describe('admin guide', () => {
  it('links only to admin screens that exist', () => {
    expect(links.length).toBeGreaterThan(10)
    expect(links.filter((h) => !h.startsWith('/admin') || !pageExists(h))).toEqual([])
  })

  it('gives every linked step a label, and every daily step starts with its label', () => {
    const steps = [...DAILY, ...WORKFLOWS.flatMap((w) => w.steps)]
    expect(steps.filter((s) => Boolean(s.href) !== Boolean(s.link))).toEqual([])
    expect(DAILY.filter((s) => !s.text.startsWith(s.link!))).toEqual([])
  })

  it('has unique section ids for the jump links', () => {
    const ids = WORKFLOWS.map((w) => w.id)
    expect(new Set([...ids, 'daily', 'roles']).size).toBe(ids.length + 2)
  })
})
