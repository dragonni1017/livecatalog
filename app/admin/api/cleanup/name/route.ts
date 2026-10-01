import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { isConfigured as isErplyConfigured } from '@/lib/erply'
import { applyNameChange } from '@/lib/product-name-fix'
import { keepsPackSpec } from '@/lib/cleanup'

export const dynamic = 'force-dynamic'

// POST { sku, expect, to, apply? } -> { apply, rows: NameChangeRow[] }
//
// One product-name correction across Erply, WooCommerce and Supabase, via the
// same lib/product-name-fix.ts that scripts/fix-product-names.ts uses. Names
// live in Erply (the sync overwrites products.name from it), so a
// Supabase-only rename would be undone the next morning.
//
// DRY RUN unless `apply` is literally true. The screen shows the dry run's
// per-system result first and only then offers to apply it.
//
// Refuses outright where Erply isn't configured (it isn't in Vercel
// production): lib/erply.ts's getSessionKey hands back a stub key in that
// case, and every lookup would come back as a convincing "SKU not in Erply".
// Same stance as the receiving apply route.
//
// Cosmetic only: a change that adds, removes or alters the pack spec is
// refused here. Those are business decisions with a reason attached and go
// through scripts/fix-product-names.ts's CHANGES list.

export async function POST(request: NextRequest) {
  try {
    if (!isErplyConfigured()) {
      return NextResponse.json({ error: 'Erply not configured here — run locally' }, { status: 503 })
    }

    const body = (await request.json().catch(() => null)) as
      | { sku?: unknown; expect?: unknown; to?: unknown; apply?: unknown }
      | null
    const sku = typeof body?.sku === 'string' ? body.sku.trim() : ''
    // `expect` is NOT trimmed: untidy whitespace is one of the things being
    // fixed, and the guard has to match the live name exactly.
    const expect = typeof body?.expect === 'string' ? body.expect : ''
    const to = typeof body?.to === 'string' ? body.to.trim() : ''
    const apply = body?.apply === true

    if (!sku || !expect || !to) {
      return NextResponse.json({ error: 'sku, expect and to are all required' }, { status: 400 })
    }
    if (to === expect) {
      return NextResponse.json({ error: 'The new name is the same as the current one.' }, { status: 400 })
    }
    if (!keepsPackSpec(expect, to)) {
      return NextResponse.json(
        {
          error:
            'That would change the pack spec. Only cosmetic fixes are made here — a pack-spec change needs a recorded reason in scripts/fix-product-names.ts.',
        },
        { status: 400 },
      )
    }

    const rows = await applyNameChange({ sku, expect, to, apply, db: getAdminClient() })

    if (apply) {
      await logAudit({
        action: 'product_name_changed',
        entity_type: 'product',
        entity_label: sku,
        old_value: expect,
        new_value: `${to} [${rows.map((r) => `${r.system}: ${r.status}`).join('; ')}]`,
        performed_by: await getActorEmail(),
      })
    }

    return NextResponse.json({ apply, rows })
  } catch (err) {
    console.error('[admin/cleanup/name] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to check the name change.' },
      { status: 500 },
    )
  }
}
