import Link from 'next/link'
import PrintButton from '@/components/admin/PrintButton'
import { DAILY, ROLES, WORKFLOWS } from '@/lib/admin-guide'

export const dynamic = 'force-static'

// "How to use the admin": one page for the owner and staff. Static text from
// lib/admin-guide.ts; every link is a real admin screen. Printable (Print /
// Save as PDF).

export default function AdminGuidePage() {
  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <div className="max-w-3xl mx-auto px-4 py-10 print:py-0">
        <div className="flex items-start justify-between gap-4 print:hidden">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Dashboard</Link>
          <PrintButton />
        </div>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">How to use the admin</h1>
        <p className="mt-2 text-sm text-gray-600">
          Start at{' '}
          <Link href="/admin/waiting" className="font-semibold text-red-600 hover:underline">Waiting on people</Link>: it lists
          everything that needs someone, who it’s for, and how long it has waited (red = untouched for over a work week).
          Click a row to go straight to the screen. Below: a daily check, the main workflows start to finish (for training
          someone new), then what each role’s screens are for.
        </p>

        <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm print:hidden">
          <a href="#daily" className="text-red-600 hover:underline">Every day</a>
          {WORKFLOWS.map((w) => (
            <a key={w.id} href={`#${w.id}`} className="text-red-600 hover:underline">{w.title.split(':')[0]}</a>
          ))}
          <a href="#roles" className="text-red-600 hover:underline">By role</a>
        </nav>

        <section id="daily" className="mt-8 break-inside-avoid">
          <h2 className="text-lg font-bold text-gray-900">Every day (5 minutes)</h2>
          <ol className="mt-3 list-decimal space-y-1 rounded-xl border border-gray-200 bg-white p-4 pl-9 text-sm text-gray-800">
            {DAILY.map((s) => (
              <li key={s.text}>
                <Link href={s.href!} className="font-semibold text-red-600 hover:underline">{s.link}</Link>
                {s.text.slice(s.link!.length)}
              </li>
            ))}
          </ol>
        </section>

        {WORKFLOWS.map((w) => (
          <section key={w.id} id={w.id} className="mt-8">
            <h2 className="text-lg font-bold text-gray-900">{w.title}</h2>
            <p className="text-sm text-gray-500">{w.what}</p>
            <ol className="mt-3 list-decimal space-y-2 rounded-xl border border-gray-200 bg-white p-4 pl-9 text-sm text-gray-800">
              {w.steps.map((s) => (
                <li key={s.text}>
                  {s.text}
                  {s.href && (
                    <>
                      {' '}
                      <Link href={s.href} className="font-semibold text-red-600 hover:underline">{s.link} →</Link>
                    </>
                  )}
                </li>
              ))}
            </ol>
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 break-inside-avoid">
              <p className="text-sm font-semibold text-amber-900">Be careful</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {w.careful.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          </section>
        ))}

        <h2 id="roles" className="mt-12 text-xl font-bold text-gray-900">By role</h2>

        {ROLES.map((role) => (
          <section key={role.who} className="mt-8 break-inside-avoid">
            <h2 className="text-lg font-bold text-gray-900">{role.who}</h2>
            <p className="text-sm text-gray-500">{role.intro}</p>
            <div className="mt-3 space-y-3">
              {role.tasks.map((t) => (
                <div key={t.screen} className="rounded-xl border border-gray-200 bg-white p-4 break-inside-avoid">
                  <Link href={t.href} className="font-semibold text-red-600 hover:underline">{t.screen} →</Link>
                  <p className="mt-1 text-sm text-gray-700">{t.what}</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-800">
                    {t.steps.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                  {t.after && <p className="mt-2 text-xs text-gray-500">{t.after}</p>}
                </div>
              ))}
            </div>
          </section>
        ))}

        <p className="mt-10 text-xs text-gray-400">
          Every change made on these screens is recorded in the Audit log with who made it, and the old value, so mistakes can
          be put back.
        </p>
      </div>
    </div>
  )
}
