import Link from 'next/link'
import PrintButton from '@/components/admin/PrintButton'

export const dynamic = 'force-static'

// "How to use the admin": one page, by role, for the owner and staff. Static
// text; every link is a real admin screen. Printable (Print / Save as PDF).

interface Task {
  screen: string
  href: string
  what: string
  steps: string[]
  after?: string
}

const ROLES: { who: string; intro: string; tasks: Task[] }[] = [
  {
    who: 'Owner',
    intro: 'Decisions only you can make. Each one takes a click or two, and everything is logged and can be undone.',
    tasks: [
      {
        screen: 'Owner questions',
        href: '/admin/owner-questions',
        what: 'Questions that used to come as a spreadsheet: QuickBooks case counts to fix, pack layouts, and names or photos that don’t match the product.',
        steps: [
          'Read the card: photo, current name, what disagrees, and the question.',
          'Type the answer and click Save answer. Click Mark done when it’s settled (for QuickBooks fixes: Done in QuickBooks once you’ve changed it there).',
          'If the answer is a new name, edit the name box and click Send to Name review.',
        ],
        after: 'Nothing is renamed until the rename is approved on Name review.',
      },
      {
        screen: 'Show these?',
        href: '/admin/show-review',
        what: 'Hidden products that already have a photo, price, category and description. Customers have searched for many of them by SKU.',
        steps: ['For each card, click Show to put it on the website, or Keep hidden to take it off the list.'],
        after: 'Show can be undone on the “Shown now” tab; a $0 product can never be shown.',
      },
      {
        screen: 'Name review',
        href: '/admin/name-review',
        what: 'Suggested product renames, each with the reason.',
        steps: ['Check or edit the suggested name and click Rename, or click Skip to keep the current name.'],
        after: 'Rename changes the name in Erply, WooCommerce and the website, and only if nobody changed it in the meantime.',
      },
      {
        screen: 'Credit applications',
        href: '/admin/credit-applications',
        what: 'Net-30 / net-60 requests from buyers.',
        steps: [
          'Click Details: “What we already know” shows their quotes on the site and whether they’re in QuickBooks or Erply.',
          'Check their payment history in QuickBooks (it isn’t on the website), then Approve or Decline.',
        ],
      },
    ],
  },
  {
    who: 'Price setter',
    intro: 'Prices are entered in Erply; the website only suggests and holds them.',
    tasks: [
      {
        screen: 'Price review',
        href: '/admin/price-review',
        what: 'Prices to decide, each with a suggested price and the reason.',
        steps: ['Check or change the price and click Approve, or Skip.'],
        after: 'Approved prices show on the website right away and are “held” until the same price is in Erply.',
      },
      {
        screen: 'Prices to type into Erply',
        href: '/admin/price-review',
        what: 'Prices set on the website that Erply doesn’t have yet.',
        steps: ['On Price review, click Download Erply list, then enter those prices in Erply.'],
        after: 'Each one clears itself from the list once Erply matches.',
      },
    ],
  },
  {
    who: 'Sales',
    intro: 'Quote requests from customers.',
    tasks: [
      {
        screen: 'Orders → Needs follow-up',
        href: '/admin/orders?view=followup',
        what: 'Quote requests nobody has answered yet, oldest first.',
        steps: [
          'Open a request to reply to the customer as usual, or',
          'for old ones already handled by phone or email, use the “Close, no email” buttons: Contacted, Lost, or Converted (asks twice: it sends the order to QuickBooks and takes the stock out).',
          'If an amber note says the same customer sent a newer quote, Duplicate closes the old one.',
        ],
        after: '“Close, no email” never emails the customer.',
      },
    ],
  },
  {
    who: 'Office',
    intro: 'QuickBooks and paperwork.',
    tasks: [
      {
        screen: 'Orders to enter in QuickBooks',
        href: '/admin/orders',
        what: 'Converted orders not yet keyed into QuickBooks.',
        steps: ['Set the filter to “QB: not entered”, key the order into QuickBooks, then click Mark entered in QB.'],
      },
      {
        screen: 'Resale certificates',
        href: '/admin/resale-certificates',
        what: 'Tax-exempt certificates customers uploaded.',
        steps: ['Open each one, check it, and click Verify or Reject (Reject asks for a reason).'],
        after: 'This only records the decision; it doesn’t change any prices or tax on its own.',
      },
    ],
  },
  {
    who: 'Warehouse & photos',
    intro: 'Things that need someone with the products in hand.',
    tasks: [
      {
        screen: 'Case-count review',
        href: '/admin/case-count-review',
        what: 'Products whose case count in the name disagrees with a shipment, QuickBooks or the box label. Shipments differ too, so pick what the warehouse actually has.',
        steps: ['Click “Use N” for the right count (or type the name) and click Change case count, or Name is right.'],
      },
      {
        screen: 'Photo shot list',
        href: '/admin/photo-shot-list',
        what: 'In-stock products that need a photo, most worth shooting first (holiday items, then what customers search for).',
        steps: [
          'Print the list (the top 50 by default), photograph the products, and name each photo by its SKU (SKU, SKU-2 …).',
          'Drop the photos on Cleanup → Needs photo. Hidden products then get a Show button right there.',
        ],
        after: 'Each product leaves the shot list once its photo is in.',
      },
    ],
  },
]

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
          Click a row to go straight to the screen. Below is what each screen is for and the clicks it takes.
        </p>

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
