/**
 * GET /api/sync/customers
 *
 * Called by Vercel Cron daily (see vercel.json), one hour after the product
 * sync. Bidirectionally reconciles the Erply and WooCommerce customer lists
 * via the erply_woo_customer_links table (migration 0019):
 *
 *   Erply -> Woo: new Erply customers get created in Woo; customers whose
 *     Erply tier changed get their Wholesale Suite role updated in Woo.
 *   Woo -> Erply: new WooCommerce signups (no existing link row) get created
 *     in Erply, defaulted to DEFAULT_TIER (Retail).
 *
 * Same full-pull-and-diff shape as /api/sync/route.ts (not incremental
 * cursors) — cheap at this volume (~3,500 rows/side) and avoids trusting
 * either API's "modified since" filtering.
 *
 * Only meant to handle the day-to-day trickle. The real Erply<->Woo gap
 * (re-derived 2026-08-07 after fixing the role=all bug, see
 * docs/memory/project-woocommerce-customer-role-filter-bug.md) turned out to
 * be tiny — ~27/50 emails, not the ~3,455 originally assumed — so no bulk
 * backfill runs from this route; scripts/backfill-erply-customers-to-woo.mjs
 * remains available for any future real gap of that size.
 *
 * Security: requires Authorization: Bearer {CRON_SECRET} header, same as
 * /api/sync.
 *
 * DISABLED 2026-08-07 pending a fix — see
 * docs/memory/project-erply-duplicate-customer-incident.md. The Woo->Erply
 * direction below only checked erply_woo_customer_links (near-empty at the
 * time) before creating a customer, never checked for an existing Erply
 * customer by email. Two manual test runs against production created 1,121
 * duplicate Erply customers before this was caught. Requires
 * SYNC_CUSTOMERS_ENABLED=true to run at all (in addition to CRON_SECRET) —
 * do not set that until the root cause is fixed AND the duplicate cleanup
 * is verified complete.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getErplyCustomers, createErplyCustomer, isConfigured as isErplyConfigured } from '@/lib/erply'
import { getAllWooCustomers, createWooCustomer, updateWooCustomerRole, isWooConfigured, NON_CUSTOMER_WOO_ROLES } from '@/lib/woo'
import { DEFAULT_TIER, wooRoleForTier, type ErplyTier } from '@/lib/tier-mapping'
import { getAdminClient } from '@/lib/supabase'

/**
 * Triaged live 2026-08-07 against the 50 Woo-only (no Erply match) accounts
 * found once role=all was fixed. Dragon confirmed: skip the 19 pre-2026
 * test/junk WordPress accounts permanently (never push to Erply). The other
 * ~21 are NOT junk — they're real wholesale customers whose Erply record
 * stores multiple addresses in one semicolon-joined `email` field (e.g.
 * "info@bazicproducts.com;hang@bazicproducts.com"), so their Woo email never
 * exact-matches. Auto-creating an Erply customer for these would duplicate
 * an existing account, not fill a real gap — skipped defensively, not by
 * Dragon's explicit call, pending an Erply-side data cleanup of that field.
 * See docs/memory/project-woocommerce-customer-role-filter-bug.md.
 */
const KNOWN_NON_SYNC_WOO_EMAILS = new Set(
  [
    // Pre-2026 test/junk WordPress accounts — Dragon confirmed skip permanently.
    'testdemo@gmail.com',
    'xya12@gmail.com',
    'carletonhughes@gmail.com',
    'dj@gmail.com',
    'test@aol.com',
    'test@gmail.com',
    'dhanaji.zende@consociatesolutions.com',
    'dhanaji.zende@consociatesolution.com',
    'ujfvhufgbed@gmail.com',
    'dhbydhbd@gmail.com',
    'test4@gmail.com',
    'test5@gmail.com',
    'test6@gmail.com',
    'test8@gmail.com',
    'testuser5678ts@gmail.com',
    'sachi1@gmail.com',
    'abir@gmail.com',
    'test1@gmail.com',
    'test3@gmail.com',
    // Real wholesale customers already in Erply under a combined multi-address
    // email field — creating here would duplicate them, not sync them.
    'info@bazicproducts.com',
    'miriam@bldcoesmetics.com',
    'mrsbak76@gmail.com',
    'barensdorff@hartigdrug.com',
    'alex@hollywoodwax.com',
    'ksnow@kittyhawk.com',
    'bkteeters2211@gmail.com',
    'sarah.stevens@palaceentertainment.com',
    'sibia@lyusa.com',
    'ray@tradeopia.com',
    'ollyollybr@gmail.com',
    'sol@redhot.lanoraredhot.la',
    'jlyons@sappbros.net',
    'klamb@sappbros.net',
    'bmcdonald@sappbros.net',
    'rsmith@sappbros.net',
    'szubinski@hotmail.com',
    'amy@smithandedwards.com',
    'invoices@surf-style.com',
    'office3@nealpatel.com',
    'fred@wonderlandgiftshoppes.com',
  ].map((e) => e.toLowerCase()),
)

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.warn('[sync/customers] CRON_SECRET not set — endpoint is unprotected')
    return true
  }
  return request.headers.get('authorization') === `Bearer ${secret}`
}

interface LinkRow {
  id: number
  email: string
  erply_customer_id: string | null
  erply_tier: string | null
  woo_customer_id: number | null
  woo_role_slug: string | null
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Hard kill switch — see the DISABLED note in the file header. Must be
  // explicitly re-enabled once the duplicate-creation bug is fixed and the
  // 1,121-record cleanup is verified complete.
  if (process.env.SYNC_CUSTOMERS_ENABLED !== 'true') {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Disabled pending fix for the 2026-08-07 duplicate-customer incident — set SYNC_CUSTOMERS_ENABLED=true to re-enable',
    })
  }

  // Same guard as /api/sync: never run against either side in stub mode.
  if (!isErplyConfigured() || !isWooConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Erply and/or WooCommerce not configured — customer sync skipped',
    })
  }

  const startedAt = Date.now()
  const db = getAdminClient()

  const result = {
    wooCreated: 0,
    wooRoleUpdated: 0,
    erplyCreated: 0,
    skippedNoRoleForTier: 0,
    skippedStaffAccount: 0,
    skippedKnownNonSync: 0,
    errors: [] as string[],
  }

  try {
    const { data: linkRows, error: linkErr } = await db.from('erply_woo_customer_links').select('*')
    if (linkErr) throw new Error(`Failed to load erply_woo_customer_links: ${linkErr.message}`)
    const links = (linkRows ?? []) as LinkRow[]
    const linkByEmail = new Map(links.map((l) => [l.email.toLowerCase(), l]))
    const linkByWooId = new Map(links.filter((l) => l.woo_customer_id != null).map((l) => [l.woo_customer_id as number, l]))

    // ── 1. Erply -> Woo ──────────────────────────────────────────────────
    const erplyCustomers = await getErplyCustomers()

    for (const c of erplyCustomers) {
      const existingLink = linkByEmail.get(c.email)
      const role = wooRoleForTier(c.tier)

      try {
        if (!existingLink) {
          // No link row yet — new Erply customer (or pre-dates the backfill).
          if (!role) {
            result.skippedNoRoleForTier++
            continue
          }
          const wooCustomer = await createWooCustomer({
            email: c.email,
            firstName: c.firstName,
            lastName: c.lastName ?? c.companyName,
            roleSlug: role.slug,
          })
          await db.from('erply_woo_customer_links').insert({
            email: c.email,
            erply_customer_id: c.customerID,
            erply_tier: c.tier,
            woo_customer_id: wooCustomer.id,
            woo_role_slug: role.slug,
            last_synced_at: new Date().toISOString(),
            last_sync_source: 'erply',
          })
          result.wooCreated++
        } else if (existingLink.erply_tier !== c.tier && existingLink.woo_customer_id) {
          // Tier changed since last sync.
          if (!role) {
            result.skippedNoRoleForTier++
            continue
          }
          await updateWooCustomerRole(existingLink.woo_customer_id, role.slug)
          await db
            .from('erply_woo_customer_links')
            .update({
              erply_tier: c.tier,
              woo_role_slug: role.slug,
              last_synced_at: new Date().toISOString(),
              last_sync_source: 'erply',
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingLink.id)
          result.wooRoleUpdated++
        }
      } catch (err) {
        result.errors.push(`erply->woo ${c.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // ── 2. Woo -> Erply ──────────────────────────────────────────────────
    const wooCustomers = await getAllWooCustomers()

    for (const wc of wooCustomers) {
      if (linkByWooId.has(wc.id)) continue // already linked (backfill or prior sync)
      if (!wc.email) continue
      if (NON_CUSTOMER_WOO_ROLES.has(wc.role)) {
        // Staff/dev account (site owner, agency, plugin support) — never
        // create an Erply customer for these. See lib/woo.ts.
        result.skippedStaffAccount++
        continue
      }
      if (KNOWN_NON_SYNC_WOO_EMAILS.has(wc.email.toLowerCase())) {
        result.skippedKnownNonSync++
        continue
      }

      try {
        const tier: ErplyTier = DEFAULT_TIER
        const created = await createErplyCustomer({
          email: wc.email,
          firstName: wc.first_name || null,
          lastName: wc.last_name || null,
          tier,
        })
        await db.from('erply_woo_customer_links').insert({
          email: wc.email,
          erply_customer_id: created.customerID,
          erply_tier: tier,
          woo_customer_id: wc.id,
          woo_role_slug: wooRoleForTier(tier)?.slug ?? null,
          last_synced_at: new Date().toISOString(),
          last_sync_source: 'woo',
        })
        result.erplyCreated++
      } catch (err) {
        result.errors.push(`woo->erply ${wc.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const elapsed = Date.now() - startedAt
    console.log(
      `[sync/customers] Done in ${elapsed}ms — wooCreated:${result.wooCreated} wooRoleUpdated:${result.wooRoleUpdated} ` +
        `erplyCreated:${result.erplyCreated} skippedNoRole:${result.skippedNoRoleForTier} skippedStaff:${result.skippedStaffAccount} ` +
        `skippedKnownNonSync:${result.skippedKnownNonSync} errors:${result.errors.length}`,
    )

    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      durationMs: elapsed,
      ...result,
    })
  } catch (err) {
    console.error('[sync/customers] Failed:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
