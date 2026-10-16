import type { getAdminClient } from '@/lib/supabase'
import { isSmtpConfigured, sendMail } from '@/lib/email'
import { todayPacific } from '@/lib/collections'

// Resale-certificate expiry emails (migration 0063), run nightly by /api/sync.
//  - reminder: once, when an active certificate is ≤ REMINDER_DAYS from expiry
//  - expired notice: once, when it expired within the last NOTICE_WINDOW_DAYS
//    (so certificates that expired long before this shipped get no surprise mail)
// Rejected, replaced and undated certificates are never emailed. A row is
// stamped only after its email actually sends, so a failed send retries the
// next night.

export const REMINDER_DAYS = 30
export const NOTICE_WINDOW_DAYS = 30
export const MAX_PER_RUN = 50
const ACCOUNT_URL = 'https://lyusa.app/account'

export interface ReminderCert {
  id: string
  email: string
  state: string
  permit_number: string
  expires_on: string | null
  status: string
  replaced_at: string | null
  reminder_sent_at: string | null
  expired_notice_sent_at: string | null
}

export type CertEmailKind = 'reminder' | 'expired'

/** Whole days from today to the expiry date (negative once expired). Both YYYY-MM-DD. */
export function daysUntil(expiresOn: string, today: string): number {
  return Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/** Pure: which certificates get which email today. */
export function pickCertEmails(certs: ReminderCert[], today: string): { cert: ReminderCert; kind: CertEmailKind; days: number }[] {
  const out: { cert: ReminderCert; kind: CertEmailKind; days: number }[] = []
  for (const c of certs) {
    if (c.replaced_at || c.status === 'rejected' || !c.expires_on) continue
    const days = daysUntil(c.expires_on, today)
    if (days < 0) {
      // Valid through its expiry date, so "expired" starts the day after.
      if (!c.expired_notice_sent_at && days >= -NOTICE_WINDOW_DAYS) out.push({ cert: c, kind: 'expired', days })
    } else if (days <= REMINDER_DAYS && !c.reminder_sent_at) {
      out.push({ cert: c, kind: 'reminder', days })
    }
  }
  return out.slice(0, MAX_PER_RUN)
}

function prettyDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function certEmail(c: ReminderCert, kind: CertEmailKind, days: number): { subject: string; text: string } {
  const which = `${c.state} certificate ${c.permit_number}`
  const when = prettyDate(c.expires_on!)
  if (kind === 'reminder') {
    return {
      subject: `Your resale certificate expires ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`,
      text:
        `Hello,\n\nYour resale / tax-exempt certificate on file with L & Y USA (${which}) expires on ${when}.\n\n` +
        `To keep tax-exempt purchasing without interruption, please upload your renewed certificate:\n${ACCOUNT_URL}\n\n` +
        `If you've already sent us a new one, you can ignore this email.\n\nThank you,\nL & Y USA\n626-552-4120`,
    }
  }
  return {
    subject: 'Your resale certificate has expired',
    text:
      `Hello,\n\nYour resale / tax-exempt certificate on file with L & Y USA (${which}) expired on ${when}.\n\n` +
      `Please upload your renewed certificate so we can keep your orders tax-exempt:\n${ACCOUNT_URL}\n\n` +
      `If you've already sent us a new one, you can ignore this email.\n\nThank you,\nL & Y USA\n626-552-4120`,
  }
}

export interface CertReminderResult {
  skipped?: string
  due: number
  sent: number
  failed: number
}

/** Nightly job. Never throws: the caller records the result in sync_runs. */
export async function checkCertificateReminders(
  db: ReturnType<typeof getAdminClient>,
  send: (args: { to: string; subject: string; text: string }) => Promise<void> = sendMail,
  today: string = todayPacific(),
): Promise<CertReminderResult> {
  if (send === sendMail && !isSmtpConfigured()) return { skipped: 'SMTP not configured', due: 0, sent: 0, failed: 0 }
  const { data, error } = await db
    .from('resale_certificates')
    .select('id, email, state, permit_number, expires_on, status, replaced_at, reminder_sent_at, expired_notice_sent_at')
    .is('replaced_at', null)
    .not('expires_on', 'is', null)
  if (error) return { skipped: `could not load certificates: ${error.message}`, due: 0, sent: 0, failed: 0 }

  const due = pickCertEmails((data ?? []) as ReminderCert[], today)
  let sent = 0
  let failed = 0
  for (const { cert, kind, days } of due) {
    try {
      const { subject, text } = certEmail(cert, kind, days)
      await send({ to: cert.email, subject, text })
      const column = kind === 'reminder' ? 'reminder_sent_at' : 'expired_notice_sent_at'
      await db.from('resale_certificates').update({ [column]: new Date().toISOString() }).eq('id', cert.id)
      sent++
    } catch (err) {
      failed++
      console.error('[cert-reminders] send failed:', err instanceof Error ? err.message : err)
    }
  }
  return { due: due.length, sent, failed }
}
