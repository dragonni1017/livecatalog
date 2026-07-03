import { createHmac } from 'crypto'

function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0, value = 0
  const output: number[] = []
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    value = (value << 5) | alphabet.indexOf(c)
    bits += 5
    if (bits >= 8) { bits -= 8; output.push((value >> bits) & 0xff) }
  }
  return Buffer.from(output)
}

export function verifyTotp(secret: string, token: string, window = 1): boolean {
  const key = base32Decode(secret)
  const step = Math.floor(Date.now() / 1000 / 30)
  for (let i = -window; i <= window; i++) {
    const t = step + i
    const msg = Buffer.alloc(8)
    msg.writeUInt32BE(Math.floor(t / 2 ** 32), 0)
    msg.writeUInt32BE(t >>> 0, 4)
    const hmac = createHmac('sha1', key).update(msg).digest()
    const offset = hmac[hmac.length - 1] & 0xf
    const code =
      (((hmac[offset] & 0x7f) << 24) |
        (hmac[offset + 1] << 16) |
        (hmac[offset + 2] << 8) |
        hmac[offset + 3]) %
      1_000_000
    if (code === parseInt(token, 10)) return true
  }
  return false
}
