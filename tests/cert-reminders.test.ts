import { describe, expect, it, vi } from 'vitest'
import { certEmail, checkCertificateReminders, daysUntil, MAX_PER_RUN, pickCertEmails, type ReminderCert } from '../lib/cert-reminders'

const TODAY = '2026-10-16'
let n = 0
const cert = (over: Partial<ReminderCert>): ReminderCert => ({
  id: `c${++n}`,
  email: `buyer${n}@example.com`,
  state: 'CA',
  permit_number: 'SR-1',
  expires_on: '2026-11-01',
  status: 'verified',
  replaced_at: null,
  reminder_sent_at: null,
  expired_notice_sent_at: null,
  ...over,
})

describe('daysUntil', () => {
  it('counts whole days', () => {
    expect(daysUntil('2026-10-16', TODAY)).toBe(0)
    expect(daysUntil('2026-11-15', TODAY)).toBe(30)
    expect(daysUntil('2026-10-15', TODAY)).toBe(-1)
  })
})

describe('pickCertEmails', () => {
  it('reminds once inside 30 days, including the expiry day itself', () => {
    const picks = pickCertEmails([cert({ expires_on: '2026-11-15' }), cert({ expires_on: '2026-10-16' }), cert({ expires_on: '2026-11-16' })], TODAY)
    expect(picks.map((p) => [p.kind, p.days])).toEqual([['reminder', 30], ['reminder', 0]])
  })
  it("doesn't remind twice", () => {
    expect(pickCertEmails([cert({ expires_on: '2026-10-20', reminder_sent_at: '2026-10-01T08:00:00Z' })], TODAY)).toEqual([])
  })
  it('sends the expired notice once, only for recent expiries', () => {
    const picks = pickCertEmails(
      [
        cert({ expires_on: '2026-10-15' }), // yesterday → notice
        cert({ expires_on: '2026-09-16' }), // 30 days ago → still in window
        cert({ expires_on: '2026-09-15' }), // 31 days ago → too old, no surprise mail
        cert({ expires_on: '2026-10-10', expired_notice_sent_at: '2026-10-11T08:00:00Z' }), // already told
      ],
      TODAY,
    )
    expect(picks.map((p) => [p.kind, p.days])).toEqual([['expired', -1], ['expired', -30]])
  })
  it('an expired cert that never got a reminder gets only the expired notice', () => {
    expect(pickCertEmails([cert({ expires_on: '2026-10-10' })], TODAY).map((p) => p.kind)).toEqual(['expired'])
  })
  it('skips rejected, replaced and undated certificates; pending ones still count', () => {
    const picks = pickCertEmails(
      [
        cert({ expires_on: '2026-10-20', status: 'rejected' }),
        cert({ expires_on: '2026-10-20', replaced_at: '2026-10-01T00:00:00Z' }),
        cert({ expires_on: null }),
        cert({ expires_on: '2026-10-20', status: 'pending' }),
      ],
      TODAY,
    )
    expect(picks).toHaveLength(1)
    expect(picks[0].cert.status).toBe('pending')
  })
  it(`caps a run at ${MAX_PER_RUN}`, () => {
    expect(pickCertEmails(Array.from({ length: 80 }, () => cert({ expires_on: '2026-10-20' })), TODAY)).toHaveLength(MAX_PER_RUN)
  })
})

describe('certEmail', () => {
  it('names the certificate and links to the account page', () => {
    const e = certEmail(cert({ state: 'TX', permit_number: 'TX-9', expires_on: '2026-11-01' }), 'reminder', 16)
    expect(e.subject).toBe('Your resale certificate expires in 16 days')
    expect(e.text).toContain('TX certificate TX-9')
    expect(e.text).toContain('November 1, 2026')
    expect(e.text).toContain('https://lyusa.app/account')
    expect(certEmail(cert({}), 'reminder', 0).subject).toBe('Your resale certificate expires today')
    expect(certEmail(cert({}), 'reminder', 1).subject).toBe('Your resale certificate expires in 1 day')
    expect(certEmail(cert({ expires_on: '2026-10-15' }), 'expired', -1).subject).toBe('Your resale certificate has expired')
  })
})

describe('checkCertificateReminders', () => {
  const rows = [cert({ id: 'due', expires_on: '2026-10-20' }), cert({ id: 'fails', expires_on: '2026-10-21' }), cert({ id: 'later', expires_on: '2027-01-01' })]
  const fakeDb = () => {
    const updates: { patch: Record<string, unknown>; id: unknown }[] = []
    const db = {
      from: () => {
        let patch: Record<string, unknown> | null = null
        const b = {
          select: () => b,
          is: () => b,
          not: () => b,
          update: (p: Record<string, unknown>) => {
            patch = p
            return b
          },
          eq: async (_col: string, id: unknown) => {
            if (patch) updates.push({ patch, id })
            return { error: null }
          },
          then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
        }
        return b
      },
    }
    return { db: db as never, updates }
  }

  it('stamps only certificates whose email actually sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, updates } = fakeDb()
    const sent: string[] = []
    const send = async ({ to }: { to: string }) => {
      if (to === rows[1].email) throw new Error('SMTP 550')
      sent.push(to)
    }
    const r = await checkCertificateReminders(db, send, TODAY)
    expect(r).toEqual({ due: 2, sent: 1, failed: 1 })
    expect(sent).toEqual([rows[0].email])
    expect(updates.map((u) => u.id)).toEqual(['due'])
    expect(Object.keys(updates[0].patch)).toEqual(['reminder_sent_at'])
  })
})
