/**
 * Pack figures read from a QuickBooks item description, and the pack spec
 * they support.
 *
 * Moved unchanged out of scripts/create-products-from-qb.ts so the product
 * creation planner and scripts/plan-pack-spec-name-fixes.ts read QuickBooks the
 * same way. The reasoning for each rule lives in
 * docs/memory/project-qb-product-create-plan-20261001.md.
 *
 * Imports carry a literal ".ts" because scripts load this under Node's native
 * type stripping (see tsconfig's allowImportingTsExtensions).
 */
import { formatPackSpec } from './product-naming.ts'

export interface Pack { perPack: number | null; perCase: number | null; perCaseUnit: 'pk' | 'bx' | 'set' | null; piecesPerCase: number | null }

/** Pull every pack token out of the text. Order matters: N/bx/cs before N/bx. */
export function parsePack(text: string): { pack: Pack; stated: string[]; rest: string } {
  const pack: Pack = { perPack: null, perCase: null, perCaseUnit: null, piecesPerCase: null }
  const stated: string[] = []
  let rest = text
  // `stated` is re-spelled in house shape ("48 pcs/cs" -> "48/cs", "150 pk's/cs"
  // -> "150pk/cs") but carries exactly the numbers the desc gave, no more.
  const take = (re: RegExp, fn: (m: RegExpExecArray) => string) => {
    for (let m = re.exec(rest); m; m = re.exec(rest)) { stated.push(fn(m)); rest = rest.replace(m[0], ' ') }
  }
  // containers per case: "60pk/cs", "150 pk's/cs", "24/bx/cs", "16bx/cs"
  take(/(\d+)\s*\/?\s*(pk's|pks|pk|bx|box(?:es)?)\s*\/\s*cs\b/i, (m) => {
    pack.perCase = Number(m[1]); pack.perCaseUnit = /^b/i.test(m[2]) ? 'bx' : 'pk'
    return `${m[1]}${pack.perCaseUnit}/cs`
  })
  take(/(\d+)\s*sets?\s*\/\s*cs\b/i, (m) => { pack.perCase = Number(m[1]); pack.perCaseUnit = 'set'; return `${m[1]}set/cs` })
  // pieces per pack: "12/pk", "50pc/pk", "12/bx", "24pcs/bx"
  take(/(\d+)\s*(?:pcs?|pc)?\s*\/\s*(?:pk|bx)\b/i, (m) => { pack.perPack = Number(m[1]); return `${m[1]}/pk` })
  // pieces per case: "48 pcs/cs", "24/cs", "240pc/cs"
  take(/(\d+)\s*(?:pcs?|pc)?\s*\/\s*cs\b/i, (m) => { pack.piecesPerCase = Number(m[1]); return `${m[1]}/cs` })
  // Print in name order: per-pack, then per-case containers, then total.
  const rank = (s: string) => (/\/pk$/.test(s) ? 0 : /(pk|bx|set)\/cs$/.test(s) ? 1 : 2)
  stated.sort((a, b) => rank(a) - rank(b))
  return { pack, stated, rest }
}

/** Builds the spec only from what the desc states. Returns null when incomplete. */
export function buildSpec(p: Pack): { spec: string | null; note: string } {
  if (p.perPack == null || p.perCase == null || p.perCaseUnit === 'set') return { spec: null, note: '' }
  if (p.piecesPerCase != null) {
    if (p.piecesPerCase === p.perPack * p.perCase) return { spec: formatPackSpec(p.perPack, p.perCase), note: 'piece-sold (pk x bx = stated pcs/cs)' }
    if (p.piecesPerCase === p.perCase) return { spec: `${p.perPack}/pk ${p.perCase}bx/cs cs.${p.perCase}${p.perCaseUnit}`, note: 'pack-sold' }
    return { spec: null, note: `inconsistent: ${p.perPack}/pk x ${p.perCase}${p.perCaseUnit}/cs != ${p.piecesPerCase}/cs` }
  }
  // "20/pk - 60pk/cs": the desc counts containers per case, so state the unit.
  return { spec: `${p.perPack}/pk ${p.perCase}bx/cs cs.${p.perCase}${p.perCaseUnit}`, note: `stated ${p.perCaseUnit} per case` }
}

/**
 * The plush test for the approved rule. Deterministic:
 *   - the QB description (pack/carton text removed) has the word "Plush" or
 *     "Plushie", OR the QB FullName path has a "Plush" parent ("Plush Toys:X");
 *   - the desc stated exactly one pack figure, a bare pieces-per-case "N/cs";
 *   - and it is not a plush-material ACCESSORY or a multi-piece SET, which are
 *     not obviously sold singly: keychain / bag charm / cup / pen / bag /
 *     backpack / slipper / hat, or a leading count of plush items ("3 Plush
 *     Grad Bears"). Those are excluded and reported, not guessed.
 */
export function plushRule(descText: string, qbFullName: string, pack: Pack): { applies: boolean; excluded?: string } {
  const isPlush = /\bplush(ie)?\b/i.test(descText) || /(^|:)[^:]*\bplush\b[^:]*:/i.test(qbFullName)
  if (!isPlush) return { applies: false }
  if (pack.piecesPerCase == null || pack.perPack != null || pack.perCase != null) {
    return { applies: false, excluded: 'pack figures are not a bare N/cs' }
  }
  const accessory = /\b(key\s?chains?|bag charms?|cups?|pens?|bags?|backpacks?|slippers?|hats?)\b/i.exec(descText)
  if (accessory) return { applies: false, excluded: `plush ${accessory[1].toLowerCase()} (accessory, may not be sold singly)` }
  if (/^\s*\d+\s+plush\b/i.test(descText)) return { applies: false, excluded: 'multi-piece set ("N Plush ...")' }
  return { applies: true }
}
