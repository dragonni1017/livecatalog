import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { digestFor, parseDigestRecipients } from '@/lib/waiting-digest'
import type { WaitingQueue } from '@/lib/waiting-queues'

const q = (key: string, who: WaitingQueue['who'], extra: Partial<WaitingQueue> = {}): WaitingQueue => ({
  key,
  title: `Title ${key}`,
  who,
  count: 2,
  countText: '2 items',
  age: null,
  note: null,
  href: `/admin/${key}`,
  ...extra,
})

describe('parseDigestRecipients', () => {
  it('reads Who=addresses pairs, case-insensitively, merging duplicates', () => {
    const { recipients, problems } = parseDigestRecipients(' owner=A@x.com ; Sales=b@x.com, a@x.com;Everyone=me@x.com; Owner=b@x.com ')
    expect(problems).toEqual([])
    expect([...recipients]).toEqual([
      ['a@x.com', ['Owner', 'Sales']],
      ['b@x.com', ['Sales', 'Owner']],
      ['me@x.com', 'everyone'],
    ])
  })
  it('reports bad entries instead of guessing', () => {
    const { recipients, problems } = parseDigestRecipients('Boss=a@x.com; Owner=not-an-email; nonsense')
    expect(recipients.size).toBe(0)
    expect(problems).toHaveLength(3)
  })
  it('is empty when unset', () => {
    expect(parseDigestRecipients(undefined).recipients.size).toBe(0)
  })
})

describe('digestFor', () => {
  const queues = [
    q('quotes', 'Sales', { age: { text: 'oldest waiting 9 days', stale: true, days: 9 } }),
    q('names', 'Owner', { note: 'last searched today' }),
  ]
  it('lists only that person\'s queues, with links', () => {
    const m = digestFor(queues, ['Owner'])!
    expect(m.subject).toBe('Waiting on you: 1 item')
    expect(m.text).toContain('- Title names: 2 items · last searched today\n  https://lyusa.app/admin/names')
    expect(m.text).not.toContain('Title quotes')
  })
  it('flags week-old items in the subject and tags "everyone" lines with who', () => {
    const m = digestFor(queues, 'everyone')!
    expect(m.subject).toBe('Waiting on you: 2 items, 1 over a week old')
    expect(m.text).toContain('- [Sales] Title quotes: 2 items · oldest waiting 9 days (over a work week)')
  })
  it('sends nothing when nothing is waiting on them', () => {
    expect(digestFor(queues, ['Photos'])).toBeNull()
  })
})

const sent = vi.hoisted(() => [] as { to: string; subject: string }[])
vi.mock('../lib/email', () => ({ isSmtpConfigured: () => true, sendMail: async (m: { to: string; subject: string }) => { sent.push(m) } }))
vi.mock('../lib/supabase', () => ({ getAdminClient: () => ({}) }))
vi.mock('../lib/waiting-load', () => ({ loadWaitingQueues: async () => [q('names', 'Owner')] }))
const { GET } = await import('../app/api/cron/waiting-digest/route')
const call = (auth: string | null, qs = '') =>
  GET(new NextRequest(`http://x/api/cron/waiting-digest${qs}`, { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  sent.length = 0
  process.env.CRON_SECRET = 's3cret'
  delete process.env.WAITING_DIGEST_TO
})

describe('GET /api/cron/waiting-digest', () => {
  it('rejects without the cron secret, and when the secret is unset', async () => {
    expect((await call(null)).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await call('Bearer s3cret')).status).toBe(401)
  })
  it('sends nothing while WAITING_DIGEST_TO is unset', async () => {
    const json = await (await call('Bearer s3cret')).json()
    expect(json.skipped).toMatch(/WAITING_DIGEST_TO/)
    expect(sent).toEqual([])
  })
  it('dry run builds but does not send; a real run sends only to people with something waiting', async () => {
    process.env.WAITING_DIGEST_TO = 'Owner=o@x.com; Photos=p@x.com'
    const dry = await (await call('Bearer s3cret', '?dry=1')).json()
    expect(dry.results.map((r: { to: string; result: string }) => [r.to, r.result])).toEqual([
      ['o@x.com', 'dry run, not sent'],
      ['p@x.com', 'nothing waiting, not sent'],
    ])
    expect(sent).toEqual([])
    await call('Bearer s3cret')
    expect(sent.map((s) => s.to)).toEqual(['o@x.com'])
  })
})
