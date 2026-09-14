import { NextRequest, NextResponse } from 'next/server'
import { binCapacity, binsNeededForCases } from '@/lib/bin-capacity'
import { extractUnitsPerCase } from '@/lib/pack'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

// GET /admin/api/bins/capacity?q=<sku or name fragment>
//
// How many cases of one product fit in each bin type, and how many bins its
// current stock would need. Pairs carton measurements (migration 0045) with
// bin dimensions (0046); the arithmetic and its caveats live in
// lib/bin-capacity.ts.
//
// Read-only.
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim()
    if (!q) {
      return NextResponse.json({ error: 'Search for a product by SKU or name.' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true, matches: [] })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    // Exact SKU first so searching a full SKU doesn't return a pile of
    // near-matches; fall back to a fuzzy search on SKU or name.
    const { data: exact, error: exactError } = await db
      .from('products')
      .select('id, sku, name, stock_qty, case_length_in, case_width_in, case_height_in, case_weight_lb')
      .eq('sku', q)
      .limit(1)
    if (exactError) throw exactError

    let matches = exact ?? []
    if (matches.length === 0) {
      const { data: fuzzy, error: fuzzyError } = await db
        .from('products')
        .select('id, sku, name, stock_qty, case_length_in, case_width_in, case_height_in, case_weight_lb')
        .or(`sku.ilike.%${q}%,name.ilike.%${q}%`)
        .eq('is_active', true)
        .order('sku')
        .limit(25)
      if (fuzzyError) throw fuzzyError
      matches = fuzzy ?? []
    }

    if (matches.length === 0) {
      return NextResponse.json({ ok: true, matches: [], binTypes: [] })
    }

    const { data: typeRows, error: typeError } = await db
      .from('bin_types')
      .select('id, name, length_in, width_in, height_in, max_weight_lb')
      .order('name')
    if (typeError) {
      if (/could not find the table|does not exist/i.test(typeError.message)) {
        return NextResponse.json(
          { error: 'Bin tables not created yet — apply migration 0046.' },
          { status: 409 },
        )
      }
      throw typeError
    }
    const binTypes = typeRows ?? []

    // How many bins exist per type, so capacity can be reported for the
    // whole warehouse and not just one shelf. ARCHIVED bins excluded --
    // they can't hold anything.
    const { data: binRows, error: binError } = await db
      .from('bins')
      .select('bin_type_id')
      .eq('status', 'ACTIVE')
      .not('bin_type_id', 'is', null)
    if (binError) throw binError
    const binCountByType = new Map<string, number>()
    for (const row of binRows ?? []) {
      const key = row.bin_type_id as string
      binCountByType.set(key, (binCountByType.get(key) ?? 0) + 1)
    }

    // Only one product gets the full treatment; a multi-match response is a
    // picker, so it carries just enough to choose from.
    const product = matches[0]
    const unitsPerCase = extractUnitsPerCase(product.name)
    // stock_qty counts individual units, while capacity is in cases -- so the
    // pack spec is what makes "how many bins does current stock need"
    // answerable at all. Without it, cases are unknown rather than assumed.
    const casesInStock =
      unitsPerCase > 0 ? Math.ceil((product.stock_qty ?? 0) / unitsPerCase) : null

    const perType = binTypes.map((type) => {
      const capacity = binCapacity(type, product)
      const binCount = binCountByType.get(type.id) ?? 0
      return {
        id: type.id,
        name: type.name,
        dimensions: {
          length_in: type.length_in,
          width_in: type.width_in,
          height_in: type.height_in,
          max_weight_lb: type.max_weight_lb,
        },
        binCount,
        ...(capacity.ok
          ? {
              casesPerBin: capacity.result.cases,
              casesByVolume: capacity.result.casesByVolume,
              casesByWeight: capacity.result.casesByWeight,
              binding: capacity.result.binding,
              orientation: capacity.result.orientation,
              volumeUtilisation: capacity.result.volumeUtilisation,
              loadedWeightLb: capacity.result.loadedWeightLb,
              casesAcrossAllBins: capacity.result.cases * binCount,
              binsForCurrentStock:
                casesInStock == null ? null : binsNeededForCases(type, product, casesInStock),
            }
          : { missing: capacity.missing }),
      }
    })

    return NextResponse.json({
      ok: true,
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        stockQty: product.stock_qty ?? 0,
        unitsPerCase: unitsPerCase > 0 ? unitsPerCase : null,
        casesInStock,
        caseLengthIn: product.case_length_in,
        caseWidthIn: product.case_width_in,
        caseHeightIn: product.case_height_in,
        caseWeightLb: product.case_weight_lb,
      },
      // Present only when the search was ambiguous, so the caller can offer a
      // choice rather than silently analysing the wrong product.
      matches:
        matches.length > 1
          ? matches.map((m) => ({ sku: m.sku, name: m.name }))
          : [],
      binTypes: perType,
    })
  } catch (err) {
    console.error('[admin/bins/capacity GET] error:', err)
    return NextResponse.json({ error: 'Failed to compute capacity' }, { status: 500 })
  }
}
