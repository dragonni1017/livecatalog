// US state / territory codes for ship-to addresses and resale certificates.
// One list so the cart, the address book, certificates and QuickBooks ship-to
// all carry the same two-letter code (free text produced "Texas", "Tx", "Fl").

export const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
}

export const US_STATES = Object.keys(US_STATE_NAMES) as readonly string[]

const BY_NAME = new Map(Object.entries(US_STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]))

/**
 * "TX", "tx", "Tx.", " texas " → "TX". Unknown → null (callers decide whether
 * that's an error or the raw value is kept).
 */
export function normalizeUsState(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim().replace(/\.+$/, '').replace(/\s+/g, ' ')
  if (!raw) return null
  const upper = raw.toUpperCase()
  if (US_STATE_NAMES[upper]) return upper
  return BY_NAME.get(raw.toLowerCase()) ?? null
}
