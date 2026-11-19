// send-test-email.ts -- sends ONE plain test email through the app's own mail
// path (lib/email.ts sendMail, Titan SMTP), to check an inbox receives what
// the app sends: e.g. after changing SALES_ALERT_TO.
//
// Run with: node scripts/send-test-email.ts <to-address>
//
// From: is what order emails use (SALES_ALERT_FROM, else the SMTP mailbox).
// "Sent" means Titan accepted it; whether it lands (inbox, spam, alias) is
// what you check at the other end. Prints addresses, never the password.
//
// Requires in .env.local: TITAN_SMTP_HOST, TITAN_SMTP_PORT, TITAN_SMTP_USER,
// TITAN_SMTP_PASS. Uses the local values, which should match Vercel's.

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { isSmtpConfigured, sendMail } from '../lib/email.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '..', '.env.local'), quiet: true })

const to = process.argv[2]
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error('Usage: node scripts/send-test-email.ts <to-address>')
  process.exit(1)
}
if (!isSmtpConfigured()) {
  console.error('SMTP not configured -- TITAN_SMTP_HOST/PORT/USER/PASS must all be set in .env.local')
  process.exit(1)
}

const from = process.env.SALES_ALERT_FROM || process.env.TITAN_SMTP_USER
const sentAt = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
console.log(`From: ${from}\nTo:   ${to}\nVia:  ${process.env.TITAN_SMTP_HOST}:${process.env.TITAN_SMTP_PORT}`)

try {
  await sendMail({
    to,
    from,
    subject: `Test email from the L & Y USA catalog (${sentAt} PT)`,
    text:
      `This is a test from the catalog website's email system, sent ${sentAt} Pacific.\n\n` +
      `If it arrived, the website can deliver order notifications to ${to}.\n` +
      `No action needed.\n`,
  })
  console.log(`Sent: Titan accepted it at ${sentAt} PT. Check ${to} (and its spam folder).`)
} catch (e) {
  console.error('Not sent:', e instanceof Error ? e.message : e)
  process.exit(1)
}
