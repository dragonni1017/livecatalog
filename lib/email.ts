/**
 * Minimal SMTP email wrapper (Titan Mail).
 *
 * Generic on purpose — no feature-specific content lives here. Sending is a
 * no-op-by-guard: callers should check isEmailConfigured() first; if the
 * TITAN_SMTP_* / REORDER_ALERT_* env vars aren't set, the feature stays dormant
 * instead of throwing.
 */
import nodemailer from 'nodemailer'

// True when the SMTP transport itself is configured, independent of any one
// feature's recipient var. Feature-specific guards (isEmailConfigured below,
// or the sales-alert check in /api/orders) build on top of this.
export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.TITAN_SMTP_HOST &&
    process.env.TITAN_SMTP_PORT &&
    process.env.TITAN_SMTP_USER &&
    process.env.TITAN_SMTP_PASS
  )
}

export function isEmailConfigured(): boolean {
  // REORDER_ALERT_FROM is optional — defaults to the authenticated mailbox.
  return isSmtpConfigured() && Boolean(process.env.REORDER_ALERT_TO)
}

interface MailArgs {
  to: string
  subject: string
  text: string
  // Optional Reply-To — e.g. the order's customer, so a rep hitting "Reply"
  // lands in a message to the customer rather than back to the system mailbox.
  replyTo?: string
  // Optional "from" override; defaults to REORDER_ALERT_FROM or the mailbox.
  from?: string
}

export async function sendMail({ to, subject, text, replyTo, from }: MailArgs): Promise<void> {
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
    from: from || process.env.REORDER_ALERT_FROM || process.env.TITAN_SMTP_USER,
    to,
    subject,
    text,
    ...(replyTo ? { replyTo } : {}),
  })
}
