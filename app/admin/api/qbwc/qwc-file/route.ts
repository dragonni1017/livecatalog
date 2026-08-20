import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET /admin/api/qbwc/qwc-file — generates the .qwc config file QuickBooks
// Web Connector needs installed on the Windows machine running QuickBooks
// Desktop. This route lives under /admin, so middleware.ts already gates it
// behind the admin auth cookie — no extra auth check needed here.
//
// Generated on demand from env vars (rather than a hand-edited static file)
// so it can never drift from the actually-deployed AppURL/credentials. The
// AppURL is derived from the current request's origin, so downloading this
// from the live site always points QBWC at the live /api/qbwc endpoint.
//
// QBWC_FILE_ID must be a STABLE value, generated once and never regenerated
// — QBWC uses OwnerID/FileID to recognize "this is the same app I already
// registered" across re-imports. Regenerating it desyncs from whatever's
// already configured in the Windows machine's QBWC UI.
export async function GET(request: NextRequest) {
  const username = process.env.QBWC_USERNAME
  const fileId = process.env.QBWC_FILE_ID

  if (!username || !fileId) {
    return NextResponse.json(
      {
        error:
          'QBWC is not configured yet. Set QBWC_USERNAME, QBWC_PASSWORD, and QBWC_FILE_ID ' +
          '(a stable GUID, generate once with crypto.randomUUID() and never change it) in ' +
          '.env.local and in Vercel, then redeploy.',
      },
      { status: 400 },
    )
  }

  const appUrl = `${request.nextUrl.origin}/api/qbwc`
  const ownerId = `{${fileId}}`
  const fileIdBraced = `{${fileId}}`

  const xml = `<?xml version="1.0"?>
<QBWCXML>
  <AppName>LY USA QuickBooks Sync</AppName>
  <AppID></AppID>
  <AppURL>${appUrl}</AppURL>
  <AppDescription>Syncs approved wholesale orders from the L &amp; Y USA catalog into QuickBooks Desktop as Sales Orders.</AppDescription>
  <AppSupport>${request.nextUrl.origin}</AppSupport>
  <UserName>${username}</UserName>
  <OwnerID>${ownerId}</OwnerID>
  <FileID>${fileIdBraced}</FileID>
  <QBType>QBFS</QBType>
  <Scheduler>
    <RunEveryNMinutes>15</RunEveryNMinutes>
  </Scheduler>
  <IsReadOnly>false</IsReadOnly>
</QBWCXML>
`

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ly-usa-qbwc.qwc"',
    },
  })
}
