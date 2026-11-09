import { NextRequest, NextResponse } from 'next/server'
import { hasBearerSecret } from '@/lib/request-auth'
import { isSmtpConfigured, sendMail } from '@/lib/email'
import { digestFor, parseDigestRecipients } from '@/lib/waiting-digest'
import { loadWaitingQueues } from '@/lib/waiting-load'
import { saveWaitingSnapshot } from '@/lib/waiting-snapshots'

// GET /api/cron/waiting-digest  (Vercel Cron, Mondays; vercel.json)
//   ?dry=1  build the emails and return them without sending
//
// Every /api/* route is public (middleware.ts), so the CRON_SECRET bearer
// check is the only guard, and it fails closed (lib/request-auth.ts).
// Dormant until WAITING_DIGEST_TO is set: with it unset, nothing is sent
// and the route says so. See lib/waiting-digest.ts for the format.
// Either way it saves the week's queue counts (waiting_snapshots) first, so
// /admin/waiting has a "since last week" even if nobody opened it.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!hasBearerSecret(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dry = new URL(request.url).searchParams.get('dry') === '1'

  let queues: Awaited<ReturnType<typeof loadWaitingQueues>> | null = null
  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const nowIso = new Date().toISOString()
    queues = await loadWaitingQueues(db, nowIso)
    if (!dry) await saveWaitingSnapshot(db, queues, nowIso)
  } catch (err) {
    console.error('[cron/waiting-digest] snapshot failed:', err)
  }

  const { recipients, problems } = parseDigestRecipients(process.env.WAITING_DIGEST_TO)
  if (recipients.size === 0) {
    return NextResponse.json({ ok: true, skipped: 'WAITING_DIGEST_TO is not set, so no digest is sent.', problems })
  }
  if (!dry && !isSmtpConfigured()) {
    return NextResponse.json({ ok: false, skipped: 'Email (TITAN_SMTP_*) is not configured.' }, { status: 503 })
  }

  try {
    if (!queues) throw new Error('Could not load the queues')
    const results: { to: string; subject: string | null; result: string; text?: string }[] = []
    for (const [to, scope] of recipients) {
      const mail = digestFor(queues, scope)
      if (!mail) {
        results.push({ to, subject: null, result: 'nothing waiting, not sent' })
        continue
      }
      if (dry) {
        results.push({ to, subject: mail.subject, result: 'dry run, not sent', text: mail.text })
        continue
      }
      try {
        await sendMail({ to, subject: mail.subject, text: mail.text })
        results.push({ to, subject: mail.subject, result: 'sent' })
      } catch (err) {
        // One bad mailbox shouldn't stop the others.
        console.error('[cron/waiting-digest] send failed:', to, err)
        results.push({ to, subject: mail.subject, result: `failed: ${err instanceof Error ? err.message : 'error'}` })
      }
    }
    return NextResponse.json({ ok: true, dry, problems, results })
  } catch (err) {
    console.error('[cron/waiting-digest] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Digest failed' }, { status: 500 })
  }
}
