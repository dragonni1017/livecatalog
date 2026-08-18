// push-new-plush-images-to-erply.mjs
// Run with: node scripts/push-new-plush-images-to-erply.mjs [--apply]
//
// The 12 new plush products (see create-missing-plush-in-erply.mjs) have
// NO images in Erply's CDN at all -- confirmed via GET cdn.erply.com/images.
// This pushes what's actually available:
//
//   A) 5 already uploaded to Cloudinary this session (upload-new-plush-
//      photos.mjs) -- pushed via cdn.erply.com/images/urls (URL-based,
//      same mechanism as backfill-cloudinary-images-to-erply.mjs).
//   B) 4 more found in a broader local search of Downloads/02_Photos/ that
//      were never uploaded anywhere -- pushed via saveProductPicture
//      (base64), the same call proven live in the original 2026-08-03
//      Erply image test (see docs/memory/project-erply-image-backfill.md).
//      One of these (P273816-46cm) was missed by an earlier exact-name
//      search because its filename has a typo: "P273816-46ccm.png".
//
// 3 SKUs still have no photo found anywhere (P273798-60cm, P273810-60cm,
// P273803-60cm) -- left alone, not fabricating anything.
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// each productID's image list afterward to confirm.
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
for (const [name, val] of Object.entries({ ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

// A) Already on Cloudinary -- push by URL
const URL_UPLOADS = [
  { sku: 'P273798-46cm', productID: 2883, url: 'https://res.cloudinary.com/vuecawyf/image/upload/v1787078475/P273798-46cm.png' },
  { sku: 'P273800-46cm', productID: 2881, url: 'https://res.cloudinary.com/vuecawyf/image/upload/v1787078477/P273800-46cm.png' },
  { sku: 'P273802-46cm', productID: 2884, url: 'https://res.cloudinary.com/vuecawyf/image/upload/v1787078478/P273802-46cm.png' },
  { sku: 'P273807-46cm', productID: 2877, url: 'https://res.cloudinary.com/vuecawyf/image/upload/v1787078478/P273807-46cm.png' },
  { sku: 'P273810-46cm', productID: 2878, url: 'https://res.cloudinary.com/vuecawyf/image/upload/v1787078479/P273810-46cm.png' },
]

// B) Local-only -- push by base64 upload
const LOCAL_UPLOADS = [
  { sku: 'P273812-60cm', productID: 2873, file: 'C:/Users/Dragon/Downloads/02_Photos/6-16-26pics/P273812.jpg' },
  { sku: 'P273815-60cm', productID: 2874, file: 'C:/Users/Dragon/Downloads/02_Photos/6-16-26pics/P273815.jpg' },
  { sku: 'P273805-60cm', productID: 2876, file: 'C:/Users/Dragon/Downloads/02_Photos/images/P273805-60.png' },
  { sku: 'P273816-46cm', productID: 2880, file: 'C:/Users/Dragon/Downloads/02_Photos/images/P273816-46ccm.png' },
]

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function main() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey
  const jwt = auth.records[0].token

  console.log('=== A) URL uploads (already on Cloudinary) ===')
  for (const u of URL_UPLOADS) console.log(`  ${u.sku} (productID ${u.productID}) <- ${u.url}`)

  console.log('\n=== B) Local base64 uploads ===')
  for (const u of LOCAL_UPLOADS) {
    const exists = fs.existsSync(u.file)
    console.log(`  ${u.sku} (productID ${u.productID}) <- ${u.file} (${exists ? 'found' : 'MISSING'})`)
    if (!exists) { console.error(`ABORT: ${u.file} not found.`); process.exit(1) }
  }

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to upload these to Erply\'s CDN.')
    return
  }

  console.log('\nUploading URL-based images...')
  const urlBody = {
    requests: URL_UPLOADS.map((u) => ({
      context: 'erply-product',
      product_id: u.productID,
      sku: u.sku,
      url: u.url,
      filename: `${u.sku}${path.extname(u.url)}`,
    })),
  }
  const urlRes = await fetch('https://cdn.erply.com/images/urls', {
    method: 'POST',
    headers: { JWT: jwt, 'Content-Type': 'application/json' },
    body: JSON.stringify(urlBody),
  })
  const urlText = await urlRes.text()
  if (!urlRes.ok) {
    console.error(`URL upload batch failed: HTTP ${urlRes.status}: ${urlText.slice(0, 500)}`)
  } else {
    console.log(`  URL batch response: ${urlText.slice(0, 500)}`)
  }

  console.log('\nUploading local base64 images...')
  for (const u of LOCAL_UPLOADS) {
    try {
      const buffer = fs.readFileSync(u.file)
      const base64 = buffer.toString('base64')
      const res = await erplyPost({
        request: 'saveProductPicture',
        sessionKey,
        productID: String(u.productID),
        picture: base64,
        filename: path.basename(u.file),
      })
      const pictureID = res.records?.[0]?.productPictureID
      console.log(`  ${u.sku}: uploaded, pictureID ${pictureID}`)
    } catch (err) {
      console.error(`  FAILED ${u.sku}: ${err.message}`)
    }
  }

  console.log('\nIndependently re-fetching each productID from cdn.erply.com to confirm...')
  const all = [...URL_UPLOADS, ...LOCAL_UPLOADS]
  for (const u of all) {
    const res = await fetch(`https://cdn.erply.com/images?productId=${u.productID}`, { headers: { JWT: jwt } })
    const json = await res.json()
    console.log(`  ${u.sku} (productID ${u.productID}): ${json.recordsReturned ?? 0} image(s)`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
