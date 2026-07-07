import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { DEFAULT_DISPLAY_SETTINGS, DisplaySettings } from '@/lib/display-settings'

const FIELDS = Object.keys(DEFAULT_DISPLAY_SETTINGS) as (keyof DisplaySettings)[]

// GET /admin/api/display-settings — current storefront display toggles.
export async function GET() {
  try {
    const db = getAdminClient()
    const { data, error } = await db.from('display_settings').select('*').eq('id', 1).single()
    if (error) throw error
    return NextResponse.json({ settings: { ...DEFAULT_DISPLAY_SETTINGS, ...data } })
  } catch (err) {
    console.error('[admin/display-settings GET] error:', err)
    return NextResponse.json({ error: 'Failed to load display settings' }, { status: 500 })
  }
}

// PATCH /admin/api/display-settings — update any subset of the boolean toggles.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()

    const updates: Record<string, boolean | string> = {}
    for (const field of FIELDS) {
      if (field in body) {
        if (typeof body[field] !== 'boolean') {
          return NextResponse.json({ error: `${field} must be a boolean` }, { status: 400 })
        }
        updates[field] = body[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const db = getAdminClient()
    updates.updated_at = new Date().toISOString()
    const { error } = await db.from('display_settings').update(updates).eq('id', 1)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/display-settings PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update display settings' }, { status: 500 })
  }
}
