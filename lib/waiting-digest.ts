// Weekly "Waiting on you" email (app/api/cron/waiting-digest). Pure.
//
// Who gets which part comes ONLY from WAITING_DIGEST_TO, so nothing is sent
// to anyone until that's set on purpose:
//   WAITING_DIGEST_TO="Owner=owner@x.com; Sales=a@x.com,b@x.com; Everyone=me@x.com"
// Each key is a Who from lib/waiting-queues.ts, or "Everyone" for the whole
// list. One email per address, listing only that person's queues; an address
// with nothing waiting gets no email.

import { WHO_ORDER, type WaitingQueue, type Who } from './waiting-queues.ts'

const SITE = 'https://lyusa.app'
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

export type DigestScope = Who[] | 'everyone'

/** address -> the parts they get. Bad entries are reported, never guessed at. */
export function parseDigestRecipients(raw: string | undefined): { recipients: Map<string, DigestScope>; problems: string[] } {
  const recipients = new Map<string, DigestScope>()
  const problems: string[] = []
  for (const part of (raw ?? '').split(';').map((p) => p.trim()).filter(Boolean)) {
    const eq = part.indexOf('=')
    if (eq < 0) {
      problems.push(`"${part}" has no "="`)
      continue
    }
    const key = part.slice(0, eq).trim()
    const who = WHO_ORDER.find((w) => w.toLowerCase() === key.toLowerCase())
    const everyone = key.toLowerCase() === 'everyone'
    if (!who && !everyone) {
      problems.push(`"${key}" is not one of ${[...WHO_ORDER, 'Everyone'].join(', ')}`)
      continue
    }
    for (const addr of part.slice(eq + 1).split(',').map((a) => a.trim().toLowerCase()).filter(Boolean)) {
      if (!EMAIL.test(addr)) {
        problems.push(`"${addr}" is not an email address`)
        continue
      }
      const cur = recipients.get(addr)
      if (everyone || cur === 'everyone') recipients.set(addr, 'everyone')
      else recipients.set(addr, [...new Set([...(cur ?? []), who!])])
    }
  }
  return { recipients, problems }
}

/** The email for one recipient, or null when nothing is waiting on them. */
export function digestFor(queues: WaitingQueue[], scope: DigestScope): { subject: string; text: string } | null {
  const mine = scope === 'everyone' ? queues : queues.filter((q) => scope.includes(q.who))
  if (mine.length === 0) return null
  const stale = mine.filter((q) => q.age?.stale).length
  const lines = mine.map((q) => {
    const age = q.age ? ` · ${q.age.text}${q.age.stale ? ' (over a work week)' : ''}` : ''
    const note = q.note ? ` · ${q.note}` : ''
    const who = scope === 'everyone' ? `[${q.who}] ` : ''
    return `- ${who}${q.title}: ${q.countText}${age}${note}\n  ${SITE}${q.href}`
  })
  const subject = `Waiting on you: ${mine.length} item${mine.length === 1 ? '' : 's'}${stale ? `, ${stale} over a week old` : ''}`
  const text = [
    'Here is what is waiting this week, longest first.',
    '',
    ...lines,
    '',
    `Everything in one place: ${SITE}/admin/waiting`,
    '',
    'You get this every Monday. To change who gets it, update WAITING_DIGEST_TO in the site settings.',
  ].join('\n')
  return { subject, text }
}
