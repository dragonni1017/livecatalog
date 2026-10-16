// Shared by the customer route (/api/account/resale-certificate), the admin
// routes (/admin/api/resale-certificates) and the pages that show a
// certificate. Table + private bucket: migration 0057.

export const RESALE_CERT_BUCKET = 'resale-certificates'
export const RESALE_CERT_MAX_BYTES = 10 * 1024 * 1024 // matches the bucket's file_size_limit

export const RESALE_CERT_STATUSES = ['pending', 'verified', 'rejected'] as const
export type ResaleCertStatus = (typeof RESALE_CERT_STATUSES)[number]

export interface ResaleCertificate {
  id: string
  user_id: string
  email: string
  file_path: string
  file_name: string | null
  state: string
  permit_number: string
  expires_on: string | null
  status: ResaleCertStatus
  review_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  replaced_at: string | null
  created_at: string
}

/** Extension → content type. The bucket enforces the same list server-side. */
export const RESALE_CERT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY', 'PR',
] as const

/** Today in YYYY-MM-DD (UTC), for comparing against expires_on. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isExpired(cert: Pick<ResaleCertificate, 'expires_on'>): boolean {
  return !!cert.expires_on && cert.expires_on < todayIso()
}

/** Short label for badges: "Verified", "Pending review", "Rejected", or "Expired". */
export function certStatusLabel(cert: Pick<ResaleCertificate, 'status' | 'expires_on'>): string {
  if (isExpired(cert)) return 'Expired'
  if (cert.status === 'verified') return 'Verified'
  if (cert.status === 'rejected') return 'Rejected'
  return 'Pending review'
}

export function certStatusClasses(cert: Pick<ResaleCertificate, 'status' | 'expires_on'>): string {
  if (isExpired(cert)) return 'bg-amber-100 text-amber-800'
  if (cert.status === 'verified') return 'bg-green-100 text-green-700'
  if (cert.status === 'rejected') return 'bg-red-100 text-red-700'
  return 'bg-gray-100 text-gray-700'
}
