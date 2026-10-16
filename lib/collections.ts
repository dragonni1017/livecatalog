import type { getAdminClient } from '@/lib/supabase'

// Curated / seasonal collections (migration 0059). Server-read only: callers
// pass the secret-key client.
//
// "Live" = is_active and today (Pacific time, where the business is) falls in
// [starts_on, ends_on], either side open when null. A collection that's live
// shows in the catalog nav and its page; otherwise the page is a 404.

export interface Collection {
  id: string
  slug: string
  name: string
  description: string | null
  is_active: boolean
  starts_on: string | null
  ends_on: string | null
  display_order: number
}

export const COLLECTION_FIELDS = 'id, slug, name, description, is_active, starts_on, ends_on, display_order'
export const MAX_COLLECTION_PRODUCTS = 300

/** Today as YYYY-MM-DD in Los Angeles. */
export function todayPacific(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function isLive(c: Pick<Collection, 'is_active' | 'starts_on' | 'ends_on'>, today: string = todayPacific()): boolean {
  if (!c.is_active) return false
  if (c.starts_on && today < c.starts_on) return false
  if (c.ends_on && today > c.ends_on) return false
  return true
}

/** Why a collection isn't live, for the admin list. Null when it is live. */
export function notLiveReason(c: Pick<Collection, 'is_active' | 'starts_on' | 'ends_on'>, today: string = todayPacific()): string | null {
  if (!c.is_active) return 'Off'
  if (c.starts_on && today < c.starts_on) return `Starts ${c.starts_on}`
  if (c.ends_on && today > c.ends_on) return `Ended ${c.ends_on}`
  return null
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export type CollectionInput = Pick<Collection, 'slug' | 'name' | 'description' | 'is_active' | 'starts_on' | 'ends_on' | 'display_order'>

/** Validates an admin create/update body. */
export function parseCollectionInput(body: Record<string, unknown>): { value: CollectionInput } | { error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 80) return { error: 'Name is required (up to 80 characters).' }
  const slug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim().toLowerCase() : slugify(name)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) {
    return { error: 'URL name can use lowercase letters, numbers and single dashes (up to 60).' }
  }
  const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
  if (description && description.length > 500) return { error: 'Description is too long (max 500 characters).' }
  const date = (v: unknown): string | null | 'bad' => {
    if (v === null || v === undefined || v === '') return null
    return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : 'bad'
  }
  const starts_on = date(body.starts_on)
  const ends_on = date(body.ends_on)
  if (starts_on === 'bad' || ends_on === 'bad') return { error: 'Dates must be YYYY-MM-DD.' }
  if (starts_on && ends_on && starts_on > ends_on) return { error: 'The start date is after the end date.' }
  const order = Number(body.display_order ?? 0)
  if (!Number.isInteger(order) || order < -1000 || order > 1000) return { error: 'Order must be a whole number.' }
  return {
    value: { slug, name, description, is_active: body.is_active !== false, starts_on, ends_on, display_order: order },
  }
}

type Db = ReturnType<typeof getAdminClient>

/** Live collections for the catalog nav, in display order. */
export async function loadLiveCollections(db: Db): Promise<Pick<Collection, 'slug' | 'name'>[]> {
  const { data, error } = await db.from('collections').select(COLLECTION_FIELDS).eq('is_active', true).order('display_order').order('name')
  if (error) return [] // never break the catalog nav over collections
  const today = todayPacific()
  return ((data ?? []) as Collection[]).filter((c) => isLive(c, today)).map((c) => ({ slug: c.slug, name: c.name }))
}

/** A collection's product ids in display order. */
export async function loadCollectionProductIds(db: Db, collectionId: string): Promise<string[]> {
  const { data } = await db
    .from('collection_products')
    .select('product_id, position')
    .eq('collection_id', collectionId)
    .order('position')
    .limit(MAX_COLLECTION_PRODUCTS)
  return ((data ?? []) as { product_id: string }[]).map((r) => r.product_id)
}
