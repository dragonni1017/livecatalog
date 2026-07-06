export default function TwoFASetupPage() {
  const secret = process.env.ADMIN_TOTP_SECRET

  if (!secret) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="mb-6">
            <a
              href="/admin"
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              &larr; Back to dashboard
            </a>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
            <h1 className="text-xl font-bold text-gray-900 mb-2">Two-Factor Authentication Setup</h1>
            <p className="text-sm text-gray-500 mb-6">
              2FA is not currently enabled. Follow the steps below to enable it.
            </p>

            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-4 text-sm text-amber-800 space-y-3 mb-6">
              <p className="font-semibold">Step 1 — Generate a secret key</p>
              <p>Run this command in your terminal to generate a base32 secret:</p>
              <pre className="bg-amber-100 rounded px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                node -e &quot;const c=require(&apos;crypto&apos;);const b=c.randomBytes(20).toString(&apos;base64url&apos;).replace(/[^A-Z2-7]/gi,&apos;&apos;).toUpperCase();console.log(b.slice(0,32))&quot;
              </pre>
              <p className="font-semibold mt-2">Step 2 — Add to Vercel</p>
              <p>
                In your{' '}
                <a
                  href="https://vercel.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-amber-900"
                >
                  Vercel project settings
                </a>
                , add the environment variable:
              </p>
              <pre className="bg-amber-100 rounded px-3 py-2 text-xs">
                ADMIN_TOTP_SECRET=&lt;your-generated-secret&gt;
              </pre>
              <p className="font-semibold mt-2">Step 3 — Redeploy</p>
              <p>Redeploy your project for the new env var to take effect.</p>
              <p className="font-semibold mt-2">Step 4 — Come back to this page</p>
              <p>
                After redeploying with the secret set, return here to scan the QR code and activate
                2FA on your authenticator app.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const otpauthUri = `otpauth://totp/LY-USA-Admin?secret=${encodeURIComponent(secret)}&issuer=LYUSACatalog`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUri)}`

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-6">
          <a
            href="/admin"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            &larr; Back to dashboard
          </a>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Two-Factor Authentication Setup</h1>
          <p className="text-sm text-gray-500 mb-8">
            Scan the QR code below with Google Authenticator or Authy, or enter the key manually.
          </p>

          <ol className="space-y-6 text-sm text-gray-700">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center">
                1
              </span>
              <div>
                Open <strong>Google Authenticator</strong> or <strong>Authy</strong> on your phone.
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center">
                2
              </span>
              <div>
                Tap <strong>+</strong> → <strong>Scan QR code</strong> or{' '}
                <strong>Enter setup key</strong>.
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center">
                3
              </span>
              <div className="space-y-4">
                <p>
                  <strong>Scan the QR code:</strong>
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrUrl}
                  alt="TOTP QR code"
                  width={200}
                  height={200}
                  className="border border-gray-200 rounded-lg"
                />
                <p>
                  <strong>Or enter the key manually:</strong>
                </p>
                <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 font-mono text-sm tracking-widest break-all text-gray-800">
                  {secret}
                </div>
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center">
                4
              </span>
              <div>
                Your authenticator will now show a 6-digit code that refreshes every 30 seconds.
                On your next login you&apos;ll be prompted to enter it after your password.
              </div>
            </li>
          </ol>

          <div className="mt-8 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
            <strong>Already set up?</strong> If you need to move to a new device, generate a new
            secret, update <code className="font-mono text-xs">ADMIN_TOTP_SECRET</code> in Vercel,
            redeploy, and re-scan.
          </div>
        </div>
      </div>
    </div>
  )
}
