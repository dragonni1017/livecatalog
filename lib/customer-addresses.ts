// Ship-to address book (migration 0058). Shared by /api/account/addresses,
// the /account card and the cart's "Ship to" picker.

export const MAX_ADDRESSES = 50

export interface CustomerAddress {
  id: string
  label: string | null
  address1: string
  address2: string | null
  city: string
  state: string
  zip: string
  is_default: boolean
}

export type AddressInput = Omit<CustomerAddress, 'id' | 'is_default'>

export const ADDRESS_FIELDS = 'id, label, address1, address2, city, state, zip, is_default'

const LIMITS = { label: 60, address1: 200, address2: 200, city: 100, state: 50, zip: 20 } as const

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Validates and normalizes a body into an address, or returns an error message. */
export function parseAddress(body: Record<string, unknown>): { address: AddressInput } | { error: string } {
  const address: AddressInput = {
    label: str(body.label) || null,
    address1: str(body.address1),
    address2: str(body.address2) || null,
    city: str(body.city),
    state: str(body.state).toUpperCase(),
    zip: str(body.zip),
  }
  if (!address.address1 || !address.city || !address.state || !address.zip) {
    return { error: 'Street, city, state and ZIP are required.' }
  }
  for (const [key, max] of Object.entries(LIMITS)) {
    const value = address[key as keyof AddressInput]
    if (value && value.length > max) return { error: `${key} is too long (max ${max} characters).` }
  }
  return { address }
}

/** One line for a picker: "Main St store — 12 Main St, Austin, TX 78701". */
export function addressSummary(a: Pick<CustomerAddress, 'label' | 'address1' | 'city' | 'state' | 'zip'>): string {
  const place = `${a.address1}, ${a.city}, ${a.state} ${a.zip}`
  return a.label ? `${a.label} — ${place}` : place
}

/** Same address, ignoring case and spacing, so the cart doesn't offer to save a duplicate. */
export function sameAddress(a: AddressInput, b: AddressInput): boolean {
  const n = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return (
    n(a.address1) === n(b.address1) &&
    n(a.address2) === n(b.address2) &&
    n(a.city) === n(b.city) &&
    n(a.state) === n(b.state) &&
    n(a.zip) === n(b.zip)
  )
}
