// Text of the admin guide (/admin/guide): the daily check, the start-to-finish
// workflows used to train someone new, and each role's screens. Kept out of
// the page so tests/admin-guide.test.ts can check every link is a real admin
// screen. When a screen's buttons or behaviour change, change the steps here.

export interface Step {
  text: string
  href?: string
  link?: string
}

export interface Workflow {
  id: string
  title: string
  what: string
  steps: Step[]
  careful: string[]
}

export const WORKFLOWS: Workflow[] = [
  {
    id: 'new-customer',
    title: 'New customer: account, net terms, and their price tier',
    what:
      'There is no approval step before a customer can shop: anyone can see the standard (Wholesale) prices and send a quote request. ' +
      'Their own price tier is something you give them, and it’s matched to them by email address.',
    steps: [
      { text: 'The customer creates an account on the website (Login at the top → “Create one”) with their email and a password. They can send quote requests without one, but they need it to get their own prices.' },
      { text: 'If they want to pay on net terms, they fill in “Apply for net terms →” at the bottom of any page. You get an email, and it appears on', link: 'Net-Terms Applications', href: '/admin/credit-applications' },
      { text: 'Open it with Details. “What we already know” shows their quotes and whether they’re in QuickBooks or Erply. Check their payment history in QuickBooks, then click Approve (pick Net 30 or Net 60) or Decline. Leave “Email …” ticked to send them the answer.' },
      { text: 'If they’re tax-exempt, they upload a resale certificate from their account page. Check it on', link: 'Resale Certificates', href: '/admin/resale-certificates' },
      { text: 'To give them their prices, go to', link: 'Customer Profiles', href: '/admin/customers' },
      { text: 'Click Add customer. Enter the exact email they sign in with, their name and company, pick the Price Tier, and click Save. For someone already listed, click Edit on their row and change Price Tier.' },
      { text: 'Tell them to sign in with that email. The top of the website then shows “<Tier> pricing” and every price is theirs, in the catalog, the cart and the order. Nothing emails them about it, so let them know yourself.' },
    ],
    careful: [
      'Tiers: Wholesale = the normal website price. Distribution Chain = 8% off. Exclusive = 24% above. Retail = double.',
      'The email must match exactly. If they sign in or order with a different email, they get standard prices.',
      'Approving net terms does not set a price tier or anything in QuickBooks. Set their terms on the QuickBooks customer yourself.',
      'A price tier set here stays on the website. It isn’t copied to Erply, WooCommerce or QuickBooks.',
      'If an order shows an amber “Buyer Discount on File” box, apply that discount in QuickBooks; it is not in the line prices.',
    ],
  },
  {
    id: 'quote-request',
    title: 'A quote request, from the customer to QuickBooks',
    what: 'Customers don’t pay on the website. They send a quote request, a person confirms it, and confirmed orders go into QuickBooks.',
    steps: [
      { text: 'The customer clicks Submit Order Request in their cart. They get an email with the reference (ORD-…), and the sales inbox gets the full order. Replying to that email goes straight to the customer.' },
      { text: 'Open', link: 'Orders → Needs follow-up', href: '/admin/orders?view=followup' },
      { text: 'Oldest first. “Waiting” turns amber after 1 work day and red after 3. Click the reference to open the order. Set Owner (follows up) to whoever is handling it.' },
      { text: 'Contact the customer to confirm items, stock and price. Then click Contacted (this emails them “someone will be in touch”).' },
      { text: 'When they confirm, click Converted. This emails them “your order is confirmed”, takes the items out of stock, and sends the order to QuickBooks. The Web Connector picks it up within about 15 minutes.' },
      { text: 'Check the order shows In QuickBooks ✓. If it doesn’t after an hour, look at the bottom of', link: 'QuickBooks Setup', href: '/admin/quickbooks' },
      { text: 'If you can’t fill it, click Lost (this emails them that it can’t be fulfilled). For a test, duplicate or spam request, pick the reason under “Test / duplicate / spam” and click Dismiss; that sends nothing.' },
    ],
    careful: [
      'Every status button emails the customer. To close old quotes you already handled by phone, use “Close, no email” on Needs follow-up.',
      'Converted can’t be taken back. Changing the status afterwards doesn’t put the stock back or take the order out of QuickBooks.',
      'Don’t key a Converted order into QuickBooks by hand while it’s waiting; the Web Connector will add it too and you’ll have two. Key by hand only if it failed or the Web Connector is down, then click Mark entered in QB.',
      'QuickBooks Setup problems: “Possible existing customer” means pick the right QuickBooks customer. “Failed syncs”: fix the reason, then Retry. “Stuck syncs”: check QuickBooks first and only Force retry if the order isn’t there.',
      'A failed sync puts the order back to New. Once Retry works, close it with “Close, no email” → Converted so the customer isn’t emailed twice.',
      'Order lines can’t be changed on the website. Change quantities or prices in QuickBooks.',
      'Out-of-stock items come through marked Backorder. Confirm timing with the customer. The sales tax on the website is only an estimate; QuickBooks works out the real tax.',
    ],
  },
  {
    id: 'products',
    title: 'Products: new containers, photos, and what shows on the website',
    what: 'Erply is the master for names, prices and stock, and the website copies it every night at about 1 AM Pacific. Photos, categories and descriptions live only on the website.',
    steps: [
      { text: 'New container: open', link: 'Receiving', href: '/admin/receiving' },
      { text: 'Upload the supplier’s “Original List” .xlsx. Check the Shipped and Received counts. Click Save counts for later, or tick “This container has not already been received.” and click Apply to add the stock in Erply.' },
      { text: 'SKUs the website doesn’t have yet appear under “New products”. Fill in name, category, price and pieces per pack, click Create in Erply, then Add created products to the catalog. They arrive hidden, at $0, needing a photo.' },
      { text: 'Photos: print the list on', link: 'Photo shot list', href: '/admin/photo-shot-list' },
      { text: 'Name each photo file by SKU (F288094.jpg, then F288094-2.jpg for extra angles). Drop them on', link: 'Catalog Cleanup → Needs photo', href: '/admin/cleanup' },
      { text: 'Check the products have a real price in Erply, then put them on the website from', link: 'Show these?', href: '/admin/show-review' },
      { text: 'Fix a single product (category, description, photo) on', link: 'Products & Stock', href: '/admin/products' },
    ],
    careful: [
      'Change names and prices in Erply. If you change them in Products & Stock, the next nightly sync puts them back (a price approved on Price review is the exception).',
      'Apply on Receiving adds stock in Erply and can’t be undone. Never apply the same container twice.',
      'A $0 product can never be shown. Price it in Erply first.',
      'Uploading a photo doesn’t put a hidden product on the website. Use Show these? or the Visible/Hidden pill.',
      'Delete is permanent, and a product that’s still in Erply comes back at the next sync. To take it off the website, hide it instead.',
      '“Hide all products without an image” on the dashboard has no confirm and no undo-all.',
      'Before Run sync now on Erply Sync, click Preview changes and check the Deactivated number. If it’s large, don’t run it.',
    ],
  },
]

export const DAILY: Step[] = [
  { text: 'Waiting on people: anything that needs someone, oldest first.', href: '/admin/waiting', link: 'Waiting on people' },
  { text: 'Needs follow-up: answer new quote requests, red ones first.', href: '/admin/orders?view=followup', link: 'Needs follow-up' },
  { text: 'QuickBooks Setup: any problems listed at the bottom.', href: '/admin/quickbooks', link: 'QuickBooks Setup' },
  { text: 'Catalog health: last night’s sync ran, and nothing visible is missing a price or photo.', href: '/admin/catalog-health', link: 'Catalog health' },
]

export interface Task {
  screen: string
  href: string
  what: string
  steps: string[]
  after?: string
}

export const ROLES: { who: string; intro: string; tasks: Task[] }[] = [
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
        screen: 'QuickBooks problems',
        href: '/admin/quickbooks',
        what: 'Converted orders go into QuickBooks by themselves through the Web Connector. This screen lists the ones that didn’t.',
        steps: [
          'Possible existing customer: click the right QuickBooks customer, or “Not a match — create new”.',
          'Failed syncs: fix what QuickBooks complained about, then click Retry.',
          'Stuck syncs: look for the order in QuickBooks first. Click Force retry only if it isn’t there.',
        ],
        after: 'Only key an order by hand if the Web Connector is down. Then click Mark entered in QB on the order so it isn’t entered twice.',
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

