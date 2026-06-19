/**
 * Minimal SMTP email wrapper (Titan Mail).
 *
 * Generic on purpose — no feature-specific content lives here. Sending is a
 * no-op-by-guard: callers should check isEmailConfigured() first; if the
 * TITAN_SMTP_* / REORDER_ALERT_* env vars aren't set, the feature stays dormant
 * instead of throwing.
 */
import nodemailer from 'nodemailer'

export function isEmailConfigured(): boolean {
  // REORDER_ALERT_FROM is optional — defaults to the authenticated mailbox.
  return Boolean(
    process.env.TITAN_SMTP_HOST &&
    process.env.TITAN_SMTP_PORT &&
    process.env.TITAN_SMTP_USER &&
    process.env.TITAN_SMTP_PASS &&
    process.env.REORDER_ALERT_TO
  )
}

interface MailArgs {
  to: string
  subject: string
  text: string
}

export async function sendMail({ to, subject, text }: MailArgs): Promise<void> {
  const port = parseInt(process.env.TITAN_SMTP_PORT ?? '465', 10)

  // Create the transporter per-call: serverless functions cold-start, so a
  // long-lived global pool buys nothing and can hold dead sockets.
  const transporter = nodemailer.createTransport({
    host: process.env.TITAN_SMTP_HOST,
    port,
    secure: port === 465, // SSL on 465, STARTTLS otherwise
    auth: {
      user: process.env.TITAN_SMTP_USER,
      pass: process.env.TITAN_SMTP_PASS,
    },
    // Don't let a bad mailbox / blocked port hang a sync indefinitely.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  })

  await transporter.sendMail({
    // Default the "from" to the authenticated mailbox if not explicitly set.
    from: process.env.REORDER_ALERT_FROM || process.env.TITAN_SMTP_USER,
    to,
    subject,
    text,
  })
}
