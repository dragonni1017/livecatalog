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
 * SYNC_CUSTOMERS_ENABLED=true to run at all in write mode (in addition to
 * CRON_SECRET) — do not set that until the fix has been dry-run-verified.
 *
 * Dry-run mode (added 2026-08-07 after the incident, same pattern every
 * scripts/*.mjs in this project already uses): defaults ON. Reads live from
 * both Erply and WooCommerce and computes the full diff, but makes NO
 * writes to either API or to Supabase — every create/update/link is only
 * counted, never executed. This is intentionally NOT gated by
 * SYNC_CUSTOMERS_ENABLED, since it's the safe way to verify the sync logic
 * against live data without the kill switch in the way.
 *   GET /api/sync/customers            -> dry run (no writes, any time)
 *   GET /api/sync/customers?apply=true -> real writes (still requires
 *                                          SYNC_CUSTOMERS_ENABLED=true)
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

  // Dry run by default — see the file header. Only ?apply=true attempts
  // real writes, and even then only if the kill switch below is on.
  const dryRun = request.nextUrl.searchParams.get('apply') !== 'true'

  // Hard kill switch — see the DISABLED note in the file header. Must be
  // explicitly re-enabled once the fix has been dry-run-verified. Does not
  // apply to dry runs, which make no writes regardless.
  if (!dryRun && process.env.SYNC_CUSTOMERS_ENABLED !== 'true') {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Write mode disabled pending fix verification for the 2026-08-07 duplicate-customer incident — set SYNC_CUSTOMERS_ENABLED=true to re-enable, or omit ?apply=true for a dry run',
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
    linkedExisting: 0,
    skippedNoRoleForTier: 0,
    skippedStaffAccount: 0,
    skippedKnownNonSync: 0,
    errors: [] as string[],
  }

  try {
    // Paginated — a bare .select('*') silently caps at Supabase's default
    // 1000-row limit. Confirmed live 2026-08-07 via dry-run mode: with 2,768
    // real link rows, an unpaginated select only saw the first 1,000 and
    // treated the other 1,768 already-linked customers as unlinked. Caught
    // before any write happened; see
    // docs/memory/project-erply-duplicate-customer-incident.md.
    const links: LinkRow[] = []
    {
      const pageSize = 1000
      let from = 0
      while (true) {
        const { data, error } = await db
          .from('erply_woo_customer_links')
          .select('*')
          .range(from, from + pageSize - 1)
        if (error) throw new Error(`Failed to load erply_woo_customer_links: ${error.message}`)
        links.push(...((data ?? []) as LinkRow[]))
        if (!data || data.length < pageSize) break
        from += pageSize
      }
    }
    const linkByEmail = new Map(links.map((l) => [l.email.toLowerCase(), l]))
    const linkByWooId = new Map(links.filter((l) => l.woo_customer_id != null).map((l) => [l.woo_customer_id as number, l]))

    // Fetch BOTH full lists up front so each direction can check whether the
    // customer already exists on the OTHER side by email — not just whether
    // a link row happens to exist. Missing this check is what caused the
    // 2026-08-07 incident (1,121 duplicate Erply customers created because
    // erply_woo_customer_links was near-empty and the only guard was
    // linkByWooId.has(wc.id)) — see
    // docs/memory/project-erply-duplicate-customer-incident.md.
    const erplyCustomers = await getErplyCustomers()
    const wooCustomers = await getAllWooCustomers()
    const erplyByEmail = new Map(erplyCustomers.map((c) => [c.email, c]))
    const wooByEmail = new Map(wooCustomers.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]))

    // Records a new link both in Supabase and in the in-memory maps above,
    // so the second loop below sees links created by the first loop in this
    // same request instead of working off a stale snapshot (which would
    // otherwise cause it to redundantly re-process the same email — caught
    // by the table's unique index, but as a noisy error, not silently). In
    // dry-run mode, the in-memory maps still update (so counting logic
    // downstream is accurate) but nothing is written to Supabase.
    async function recordLink(row: {
      email: string
      erply_customer_id: string
      erply_tier: string
      woo_customer_id: number
      woo_role_slug: string | null
      last_sync_source: 'erply' | 'woo'
    }) {
      const email = row.email.toLowerCase()
      if (!dryRun) {
        await db.from('erply_woo_customer_links').insert({
          ...row,
          email,
          last_synced_at: new Date().toISOString(),
        })
      }
      const stored: LinkRow = {
        id: -1,
        email,
        erply_customer_id: row.erply_customer_id,
        erply_tier: row.erply_tier,
        woo_customer_id: row.woo_customer_id,
        woo_role_slug: row.woo_role_slug,
      }
      linkByEmail.set(email, stored)
      linkByWooId.set(row.woo_customer_id, stored)
    }

    // ── 1. Erply -> Woo ──────────────────────────────────────────────────
    for (const c of erplyCustomers) {
      const existingLink = linkByEmail.get(c.email)
      const role = wooRoleForTier(c.tier)

      try {
        if (!existingLink) {
          const existingWoo = wooByEmail.get(c.email)
          if (existingWoo) {
            // Already exists in Woo under this email, just never linked —
            // link them, do not create a duplicate.
            await recordLink({
              email: c.email,
              erply_customer_id: c.customerID,
              erply_tier: c.tier,
              woo_customer_id: existingWoo.id,
              woo_role_slug: role?.slug ?? null,
              last_sync_source: 'erply',
            })
            result.linkedExisting++
            continue
          }
          if (!role) {
            result.skippedNoRoleForTier++
            continue
          }
          // dry run: never call createWooCustomer -- a real write to Woo,
          // not just Supabase. Use a synthetic negative id purely so the
          // in-memory link map has something to key on for this request.
          const wooCustomerId = dryRun
            ? -(1000000 + result.wooCreated)
            : (
                await createWooCustomer({
                  email: c.email,
                  firstName: c.firstName,
                  lastName: c.lastName ?? c.companyName,
                  roleSlug: role.slug,
                })
              ).id
          await recordLink({
            email: c.email,
            erply_customer_id: c.customerID,
            erply_tier: c.tier,
            woo_customer_id: wooCustomerId,
            woo_role_slug: role.slug,
            last_sync_source: 'erply',
          })
          result.wooCreated++
        } else if (existingLink.erply_tier !== c.tier && existingLink.woo_customer_id) {
          // Tier changed since last sync.
          if (!role) {
            result.skippedNoRoleForTier++
            continue
          }
          if (!dryRun) {
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
          }
          result.wooRoleUpdated++
        }
      } catch (err) {
        result.errors.push(`erply->woo ${c.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // ── 2. Woo -> Erply ──────────────────────────────────────────────────
    for (const wc of wooCustomers) {
      if (!wc.email) continue
      const emailLower = wc.email.toLowerCase()
      if (linkByWooId.has(wc.id) || linkByEmail.has(emailLower)) continue // already linked
      if (NON_CUSTOMER_WOO_ROLES.has(wc.role)) {
        // Staff/dev account (site owner, agency, plugin support) — never
        // create an Erply customer for these. See lib/woo.ts.
        result.skippedStaffAccount++
        continue
      }
      if (KNOWN_NON_SYNC_WOO_EMAILS.has(emailLower)) {
        result.skippedKnownNonSync++
        continue
      }

      try {
        const existingErply = erplyByEmail.get(emailLower)
        if (existingErply) {
          // Already exists in Erply under this email, just never linked —
          // link them, do not create a duplicate.
          await recordLink({
            email: emailLower,
            erply_customer_id: existingErply.customerID,
            erply_tier: existingErply.tier,
            woo_customer_id: wc.id,
            woo_role_slug: wooRoleForTier(existingErply.tier)?.slug ?? null,
            last_sync_source: 'woo',
          })
          result.linkedExisting++
          continue
        }

        const tier: ErplyTier = DEFAULT_TIER
        // dry run: never call createErplyCustomer -- a real write to Erply,
        // not just Supabase. Synthetic negative id, same reasoning as above.
        const erplyCustomerId = dryRun
          ? String(-(2000000 + result.erplyCreated))
          : (
              await createErplyCustomer({
                email: wc.email,
                firstName: wc.first_name || null,
                lastName: wc.last_name || null,
                tier,
              })
            ).customerID
        await recordLink({
          email: emailLower,
          erply_customer_id: erplyCustomerId,
          erply_tier: tier,
          woo_customer_id: wc.id,
          woo_role_slug: wooRoleForTier(tier)?.slug ?? null,
          last_sync_source: 'woo',
        })
        result.erplyCreated++
      } catch (err) {
        result.errors.push(`woo->erply ${wc.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const elapsed = Date.now() - startedAt
    console.log(
      `[sync/customers] ${dryRun ? 'DRY RUN' : 'APPLIED'} — Done in ${elapsed}ms — wooCreated:${result.wooCreated} ` +
        `wooRoleUpdated:${result.wooRoleUpdated} erplyCreated:${result.erplyCreated} linkedExisting:${result.linkedExisting} ` +
        `skippedNoRole:${result.skippedNoRoleForTier} skippedStaff:${result.skippedStaffAccount} ` +
        `skippedKnownNonSync:${result.skippedKnownNonSync} errors:${result.errors.length}`,
    )

    return NextResponse.json({
      ok: true,
      dryRun,
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
