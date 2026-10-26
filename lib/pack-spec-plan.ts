/**
 * Proposes a pack spec for a catalog name that has none, from the product's
 * QuickBooks item description. Pure: scripts/plan-pack-spec-name-fixes.ts
 * loads the data and writes the plan; nothing here reads or writes anything.
 *
 * A proposal is made only where the figures say it unambiguously, or where a
 * pack rule Dragon approved applies. Everything else is left for a person.
 * QuickBooks' "N/cs" can count pieces OR packs (the floral papers read 60/cs
 * and are 20/pk 60bx/cs), which is why the naming audit proposes nothing for
 * a missing spec (lib/product-naming.ts) and why this stays narrow:
 *
 *   qb-stated      QB states per-pack AND per-case figures that agree
 *                  (buildSpec, the same test the product-creation planner uses).
 *   qb-derived     QB states N/pk and M/cs only; bx = M / N when it divides.
 *                  Assumes M counts pieces, so the plan marks it "verify".
 *   plush-1pk      Approved 2026-10-01: a plush whose QB desc is a bare N/cs
 *                  is sold singly, 1/pk Nbx/cs cs.N (plushRule).
 *   tumbler-1pk    Approved 2026-10-06: T6422xx tumblers sold by the piece,
 *                  except T642208 and T642240 (not tumblers).
 *   keychain-12pk  Approved 2026-10-06: K229492-K229560 keychains are 12/pk,
 *                  except K229491 and K229497.
 *
 * Rules and their reasons: docs/memory/project-qb-product-create-plan-20261001.md.
 * Rejected as 1/pk there by catalog evidence, so never inferred here: squish,
 * 3D printed, umbrellas, tissue/paper, crowns, pot bases.
 */
import { auditProductName, formatPackSpec } from './product-naming.ts'
import { CARTON_DIMS_RE, CARTON_WEIGHT_RE, PACK_TOKEN_RES } from './qb-descriptor.ts'
import { buildSpec, parsePack, plushRule } from './qb-pack.ts'

export type PackSpecRule = 'qb-stated' | 'qb-derived' | 'plush-1pk' | 'tumbler-1pk' | 'keychain-12pk'

export interface PackSpecPlan {
  status: 'propose' | 'needs_person'
  /** The proposed name; null when there is no proposal. */
  to: string | null
  rule: PackSpecRule | null
  /** Why, for the reviewer: the rule applied, or what is missing. */
  why: string
  /** The pack figures QuickBooks states, as read ("12/pk 108/cs"). */
  qbStated: string
}

/**
 * The live name with any pack text removed: an empty template left by a
 * creation path ("Dynasty Dragon 11 - /pk bx/cs cs.") or a bare QuickBooks
 * count ("SeaCreature Keychain - 240/cs"). Only whitespace is otherwise
 * touched, so a reviewer sees exactly one change: the spec.
 */
export function nameHead(name: string): string {
  let head = (name ?? '').replace(/\s*-\s*\/\s*pk\s*bx\s*\/\s*cs\s*cs\.\s*$/i, '')
  for (const re of PACK_TOKEN_RES) {
    for (let m = re.exec(head); m; m = re.exec(head)) head = head.replace(m[0], ' ')
  }
  return head.replace(/\s+/g, ' ').replace(/(\s*-\s*)+$/, '').trim()
}

function inRange(sku: string, prefix: string, lo: number, hi: number): boolean {
  const m = new RegExp(`^${prefix}(\\d+)$`, 'i').exec(sku.trim())
  return !!m && Number(m[1]) >= lo && Number(m[1]) <= hi
}

export function planPackSpecName(input: {
  sku: string
  name: string
  qbDesc: string | null
  qbFullName?: string | null
}): PackSpecPlan {
  const sku = input.sku.trim().toUpperCase()
  const head = nameHead(input.name)
  const none = (why: string, qbStated = ''): PackSpecPlan => ({ status: 'needs_person', to: null, rule: null, why, qbStated })

  if (!head) return none('nothing left of the name once pack text is removed')
  if (!input.qbDesc) return none('not in the QuickBooks item directory: needs counting')

  let desc = input.qbDesc.replace(/\r?\n/g, ' - ')
  for (const re of [CARTON_DIMS_RE, CARTON_WEIGHT_RE]) desc = desc.replace(re, ' ')
  const { pack, stated, rest } = parsePack(desc)
  const qbStated = stated.join(' ')

  const propose = (spec: string, rule: PackSpecRule, why: string): PackSpecPlan => {
    const to = `${head} - ${spec}`
    const audit = auditProductName(to)
    if (audit.issues.length) return none(`proposal "${to}" fails the audit (${audit.issues.join(', ')})`, qbStated)
    return { status: 'propose', to, rule, why, qbStated }
  }

  const built = buildSpec(pack)
  if (built.spec) return propose(built.spec, 'qb-stated', `QuickBooks states it: ${built.note}`)
  if (built.note) return none(`QuickBooks figures disagree: ${built.note}`, qbStated)

  const bare = pack.piecesPerCase != null && pack.perPack == null && pack.perCase == null

  if (pack.perPack != null && pack.perCase == null && pack.piecesPerCase != null) {
    if (pack.piecesPerCase % pack.perPack === 0) {
      return propose(
        formatPackSpec(pack.perPack, pack.piecesPerCase / pack.perPack),
        'qb-derived',
        `VERIFY: QuickBooks states ${pack.perPack}/pk and ${pack.piecesPerCase}/cs; boxes = ${pack.piecesPerCase} / ${pack.perPack}, assuming /cs counts pieces`,
      )
    }
    return none(`QuickBooks ${pack.piecesPerCase}/cs is not a multiple of ${pack.perPack}/pk`, qbStated)
  }

  if (bare) {
    const n = pack.piecesPerCase!
    // The SKU ranges below are not product types: T6422xx also holds leather
    // patches, fans and a pill box, and K2295xx a bag/wallet. So each rule
    // also needs the product to say what it is.
    const words = `${input.name} ${input.qbDesc} ${input.qbFullName ?? ''}`
    // K-series plush are keychain plush (accessories), which the plush rule
    // was approved to exclude; they fall through to the keychain rule.
    const plush = /^K/.test(sku) ? { applies: false, excluded: 'K-series: keychain plush' } : plushRule(rest, input.qbFullName ?? '', pack)
    if (plush.applies) return propose(formatPackSpec(1, n), 'plush-1pk', 'plush sold singly (rule approved 2026-10-01)')
    if (inRange(sku, 'T', 642200, 642299) && sku !== 'T642208' && sku !== 'T642240' && /\btumblers?\b/i.test(words)) {
      return propose(formatPackSpec(1, n), 'tumbler-1pk', 'T6422xx tumbler sold by the piece (rule approved 2026-10-06)')
    }
    if (inRange(sku, 'K', 229492, 229560) && sku !== 'K229497' && /key\s?chains?|charms?/i.test(words)) {
      if (n % 12 === 0) return propose(formatPackSpec(12, n / 12), 'keychain-12pk', 'K229492-K229560 keychain, 12/pk (rule approved 2026-10-06)')
      return none(`keychain rule needs ${n}/cs to be a multiple of 12`, qbStated)
    }
    return none(
      plush.excluded
        ? `QuickBooks gives only ${n}/cs; plush rule not applied (${plush.excluded})`
        : `QuickBooks gives only ${n}/cs: pieces per pack unknown`,
      qbStated,
    )
  }

  return none(qbStated ? `QuickBooks figures incomplete: ${qbStated}` : 'QuickBooks states no pack figures: needs counting', qbStated)
}
