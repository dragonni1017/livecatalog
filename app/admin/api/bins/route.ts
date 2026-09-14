import { NextRequest, NextResponse } from 'next/server'
import { implausibleBinType, parseMeasurementInput } from '@/lib/measurements'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

// Bin capacity admin (migration 0046). Bins themselves are mirrored from
// Erply by scripts/seed-bins-from-erply.mjs and are not created here -- Erply
// owns which bins exist. What this route edits is how big they are, which
// Erply has no field for.
//
// INCHES AND POUNDS, matching products.case_*_in / case_weight_lb, because a
// capacity calculation divides one by the other.

const DIMENSION_FIELDS = ['length_in', 'width_in', 'height_in', 'max_weight_lb'] as const

const FIELD_LABELS: Record<(typeof DIMENSION_FIELDS)[number], string> = {
  length_in: 'Length (in)',
  width_in: 'Width (in)',
  height_in: 'Height (in)',
  max_weight_lb: 'Weight limit (lb)',
}

// Parses the four measurement inputs off a request body into DB values.
// Returns an error string for the first unusable value, so the caller can
// surface it verbatim.
function readMeasurements(body: Record<string, unknown>) {
  const values: Record<string, number | null> = {}
  for (const field of DIMENSION_FIELDS) {
    if (!(field in body)) continue
    const raw = body[field]
    if (raw === null) {
      values[field] = null
      continue
    }
    const { value, error } = parseMeasurementInput(raw)
    if (error) return { error: `${FIELD_LABELS[field]}: ${error}` }
    values[field] = value
  }
  return { values }
}

// POST /admin/api/bins — create a bin type
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.action !== 'create_type') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: 'Give the bin type a name.' }, { status: 400 })
    }

    const { values, error: parseError } = readMeasurements(body)
    if (parseError) return NextResponse.json({ error: parseError }, { status: 400 })

    const reason = implausibleBinType(values!)
    if (reason) {
      return NextResponse.json({ error: `That can't be a real bin: ${reason}` }, { status: 400 })
    }

    if (isMockMode()) return NextResponse.json({ ok: true, mock: true })

    const { getAdminClient } = await import('@/lib/supabase')
    const { data, error } = await getAdminClient()
      .from('bin_types')
      .insert({ name, ...values, notes: typeof body.notes === 'string' ? body.notes.trim() || null : null })
      .select('id')
      .maybeSingle()
    if (error) {
      // 23505 is unique_violation -- the name is the only unique column here.
      if (error.code === '23505') {
        return NextResponse.json({ error: `A bin type called "${name}" already exists.` }, { status: 400 })
      }
      throw error
    }

    return NextResponse.json({ ok: true, id: data?.id })
  } catch (err) {
    console.error('[admin/bins POST] error:', err)
    return NextResponse.json({ error: 'Failed to create bin type' }, { status: 500 })
  }
}

// PATCH /admin/api/bins — update a bin type's measurements, or assign a type
// to a set of bins.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()

    if (body.action === 'update_type') {
      const id: string = body.id
      if (!id) return NextResponse.json({ error: 'Missing bin type id' }, { status: 400 })

      const { values, error: parseError } = readMeasurements(body)
      if (parseError) return NextResponse.json({ error: parseError }, { status: 400 })

      const updates: Record<string, unknown> = { ...values }
      if (typeof body.name === 'string') {
        const name = body.name.trim()
        if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
        updates.name = name
      }
      if (typeof body.notes === 'string') updates.notes = body.notes.trim() || null

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
      }

      if (isMockMode()) return NextResponse.json({ ok: true, mock: true })

      const { getAdminClient } = await import('@/lib/supabase')
      const db = getAdminClient()

      // Validate the merged result, not just the submitted fields: sending a
      // height alone has to be judged against the dimensions already stored.
      const { data: current, error: currentError } = await db
        .from('bin_types')
        .select('length_in, width_in, height_in, max_weight_lb')
        .eq('id', id)
        .maybeSingle()
      if (currentError) throw currentError
      if (!current) return NextResponse.json({ error: 'Bin type not found' }, { status: 404 })

      const merged: Record<string, number | null> = {}
      for (const field of DIMENSION_FIELDS) {
        const existing = (current as Record<string, unknown>)[field]
        merged[field] = field in values!
          ? values![field]
          : existing == null ? null : Number(existing)
      }
      const reason = implausibleBinType(merged)
      if (reason) {
        return NextResponse.json({ error: `That can't be a real bin: ${reason}` }, { status: 400 })
      }

      updates.updated_at = new Date().toISOString()
      const { error } = await db.from('bin_types').update(updates).eq('id', id)
      if (error) {
        if (error.code === '23505') {
          return NextResponse.json({ error: 'Another bin type already uses that name.' }, { status: 400 })
        }
        throw error
      }
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'assign_type') {
      const binIds: unknown = body.bin_ids
      if (!Array.isArray(binIds) || binIds.length === 0 || !binIds.every((v) => typeof v === 'string' && v)) {
        return NextResponse.json({ error: 'Select at least one bin.' }, { status: 400 })
      }
      // null is a valid target: it clears the assignment, putting those bins
      // back to unknown capacity.
      const binTypeId: string | null = body.bin_type_id ?? null
      if (binTypeId !== null && typeof binTypeId !== 'string') {
        return NextResponse.json({ error: 'bin_type_id must be a string or null' }, { status: 400 })
      }

      if (isMockMode()) return NextResponse.json({ ok: true, mock: true, affected: binIds.length })

      const { getAdminClient } = await import('@/lib/supabase')
      const { data, error } = await getAdminClient()
        .from('bins')
        .update({ bin_type_id: binTypeId, updated_at: new Date().toISOString() })
        .in('id', binIds as string[])
        .select('id')
      if (error) throw error
      return NextResponse.json({ ok: true, affected: data?.length ?? 0 })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[admin/bins PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

// DELETE /admin/api/bins?type_id=... — remove a bin type.
// bins.bin_type_id is ON DELETE SET NULL, so the bins survive and simply go
// back to unknown capacity; no bin is ever removed from here.
export async function DELETE(request: NextRequest) {
  try {
    const typeId = request.nextUrl.searchParams.get('type_id')
    if (!typeId) return NextResponse.json({ error: 'Missing type_id' }, { status: 400 })

    if (isMockMode()) return NextResponse.json({ ok: true, mock: true })

    const { getAdminClient } = await import('@/lib/supabase')
    const { error } = await getAdminClient().from('bin_types').delete().eq('id', typeId)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/bins DELETE] error:', err)
    return NextResponse.json({ error: 'Failed to delete bin type' }, { status: 500 })
  }
}
