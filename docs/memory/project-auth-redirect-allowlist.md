---
name: project-auth-redirect-allowlist
description: 2026-09-09 password reset was dead for all customers — the live domain lyusa.app was never added to Supabase's redirect allow-list, and GoTrue silently substitutes the Site URL instead of erroring
type: project
---

The production domain is **`lyusa.app`**; `livecatalog.vercel.app` is only the
underlying Vercel deployment. Supabase Auth's **Redirect URLs** allow-list had
`livecatalog.vercel.app` but *not* `lyusa.app`, so every customer password
reset was broken from the day the custom domain went live.

**RESOLVED 2026-09-09** — allow-list and Site URL both updated to `lyusa.app`;
re-probed and confirmed. Current state: `lyusa.app/**` and
`http://localhost:3000/**` allowed; `www.lyusa.app` is *not* allowed but also
does not resolve (no DNS), so it's a non-issue. **`livecatalog.vercel.app` is
now blocked**, as are all `*-git-*.vercel.app` preview URLs — so the reset flow
cannot be tested from a preview deployment or the raw Vercel URL, only from
`lyusa.app` or localhost. Don't mistake that for the bug recurring.

**Why:** GoTrue does not reject a `redirect_to` that isn't allow-listed — it
**silently swaps in the Site URL** and returns success. So
`resetPasswordForEmail(email, { redirectTo: 'https://lyusa.app/...' })`
produced an email whose link dumped the customer on the *homepage of a
different domain*: no callback, no session, no password form, no error
anywhere. The PKCE code verifier cookie was scoped to `lyusa.app` too, so even
the fallback landing could never have completed the exchange.

**How to apply:**

- **Any time a redirect-based auth flow "does nothing"** (reset, magic link,
  email confirm, OAuth), check the allow-list *before* reading application
  code. Confirm it empirically rather than trusting the dashboard — with the
  service role key:

  ```js
  const { data } = await db.auth.admin.generateLink({
    type: 'recovery', email: <any real user>, options: { redirectTo: <url to test> },
  })
  // data.properties.redirect_to !== the url you passed  ⇒ NOT allow-listed
  ```

  `generateLink` mints without mailing, so this is safe to run against real
  accounts. Probe several candidate URLs in one script.
- **Adding a domain to Vercel is only half the job.** Any new domain or
  preview-URL pattern must also be added to Supabase → Authentication → URL
  Configuration → Redirect URLs (`https://lyusa.app/**`), and the Site URL
  should point at the real customer-facing domain. Nothing in the repo
  encodes this, and nothing fails loudly when it's missed.
- Don't diagnose this from `auth.users`: `recovery_sent_at` and `identities`
  come back empty from the admin `listUsers` API on this project regardless of
  reality, so they look alarming and prove nothing.

Related: the flow now lands on `/reset-password`
(`app/(catalog)/reset-password/page.tsx`), which accepts all three grant shapes
GoTrue can send (`?code=` PKCE, `?token_hash=`, `#access_token=`) instead of
only PKCE, and reports a reason when it can't establish a session.
`resetPasswordForEmail`'s error was previously discarded entirely, so SMTP and
rate-limit failures also rendered as "Check your email."

One failure mode survives by design: PKCE keeps its verifier on the device that
*requested* the reset, so requesting on desktop and opening the mail on a phone
cannot complete. That is now an explicit message rather than silence. Switching
the Supabase email template to `{{ .TokenHash }}` would remove the limitation —
not done, since it needs a dashboard template edit.
