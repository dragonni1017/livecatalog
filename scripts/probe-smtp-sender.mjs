// probe-smtp-sender.mjs -- does Titan accept the app's from-address?
//
// Run with: node scripts/probe-smtp-sender.mjs
//
// Speaks raw SMTP: EHLO -> AUTH -> MAIL FROM -> RSET -> QUIT. It stops at
// MAIL FROM and never issues DATA, so NO EMAIL IS SENT -- Titan's
// "553 5.7.1 ... not owned by user" sender rejection lands at MAIL FROM,
// which is exactly what we need to observe.
//
// Reads TITAN_SMTP_{HOST,PORT,USER,PASS} + SALES_ALERT_FROM /
// REORDER_ALERT_FROM from .env.local. Prints addresses and server replies,
// never the password.
import { config } from 'dotenv'
import net from 'node:net'
import tls from 'node:tls'

config({ path: '.env.local', quiet: true })

const CRLF = String.fromCharCode(13, 10)
const NUL = String.fromCharCode(0)

const host = process.env.TITAN_SMTP_HOST
const port = parseInt(process.env.TITAN_SMTP_PORT ?? '465', 10)
const user = process.env.TITAN_SMTP_USER
const pass = process.env.TITAN_SMTP_PASS
if (!host || !user || !pass) {
  console.error('SMTP env incomplete -- TITAN_SMTP_HOST/USER/PASS must all be set in .env.local')
  process.exit(1)
}

// The addresses the app would actually put in From:, per lib/email.ts and
// lib/order-emails.ts, in the order the code falls through them. The
// authenticated mailbox goes last as a control -- it is always legal.
const senders = [...new Set([
  process.env.SALES_ALERT_FROM,
  process.env.REORDER_ALERT_FROM,
  user,
  // Any address named on the command line, e.g. one set only in Vercel.
  ...process.argv.slice(2),
].filter(Boolean))]

// A reply is finished on a line "NNN text" (space in column 4); multi-line
// replies use "NNN-" on every line but the last.
const isFinal = (line) => line.length >= 4 && line[3] === ' ' && /^[0-9][0-9][0-9]$/.test(line.slice(0, 3))

function reader(sock) {
  let buf = ''
  const waiters = []
  const pump = () => {
    while (waiters.length) {
      const lines = buf.split(CRLF)
      let cut = -1
      for (let i = 0; i < lines.length - 1; i++) {
        if (isFinal(lines[i])) { cut = i; break }
      }
      if (cut === -1) return
      const reply = lines.slice(0, cut + 1).join(' | ')
      buf = lines.slice(cut + 1).join(CRLF)
      waiters.shift()(reply)
    }
  }
  sock.on('data', (d) => { buf += d.toString('utf8'); pump() })
  return () => new Promise((res) => { waiters.push(res); pump() })
}

async function run() {
  const implicit = port === 465
  let sock = implicit ? tls.connect({ host, port, servername: host }) : net.connect({ host, port })
  await new Promise((res, rej) => {
    sock.once(implicit ? 'secureConnect' : 'connect', res)
    sock.once('error', rej)
  })
  sock.setTimeout(15000, () => { console.error('timed out waiting on the server'); process.exit(1) })

  let next = reader(sock)
  const say = async (cmd, shown) => {
    sock.write(cmd + CRLF)
    const reply = await next()
    console.log('  > ' + (shown || cmd))
    console.log('  < ' + reply)
    return reply
  }

  console.log('connecting to ' + host + ':' + port + (implicit ? ' (implicit TLS)' : ' (STARTTLS)'))
  console.log('  < ' + await next())
  await say('EHLO livecatalog.probe')

  if (!implicit) {
    await say('STARTTLS')
    const plain = sock
    sock = tls.connect({ socket: plain, host, servername: host })
    await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej) })
    next = reader(sock)
    await say('EHLO livecatalog.probe')
  }

  const auth = Buffer.from(NUL + user + NUL + pass).toString('base64')
  const authReply = await say('AUTH PLAIN ' + auth, 'AUTH PLAIN <redacted>')
  if (!authReply.startsWith('235')) {
    console.log('')
    console.log('AUTH FAILED as ' + user + ' -- cannot test senders.')
    sock.end()
    return
  }
  console.log('')
  console.log('authenticated as ' + user)
  console.log('')

  for (const v of ['SALES_ALERT_FROM', 'REORDER_ALERT_FROM', 'SALES_ALERT_TO', 'REORDER_ALERT_TO']) {
    console.log('  .env.local ' + v + ': ' + (process.env[v] ? process.env[v] : '(not set)'))
  }
  console.log('')

  const results = []
  for (const from of senders) {
    const reply = await say('MAIL FROM:<' + from + '>')
    results.push({ from, ok: reply.startsWith('250'), reply })
    await say('RSET')
  }
  await say('QUIT')
  sock.end()

  console.log('')
  console.log('=== RESULT (no message body was ever sent) ===')
  for (const r of results) {
    const tag = r.from === user ? '  (control: the authenticated mailbox)' : ''
    console.log((r.ok ? 'ACCEPTED' : 'REJECTED') + '  From: ' + r.from + tag)
    if (!r.ok) console.log('          ' + r.reply)
  }
}

run().catch((e) => { console.error('probe failed: ' + e.message); process.exit(1) })
