// report-category-cleanup.ts
// Run with: npx tsx scripts/report-category-cleanup.ts [--out=data/category-cleanup.xlsx]
//
// READ-ONLY. Three review lists for tidying categories, one xlsx tab each.
// Nothing is changed; the "Suggested" columns are for a person to approve.
//
//  1. Catalog categories — product counts (all / visible), and a suggestion
//     for empty or near-empty ones.
//  2. Erply groups — how many Erply products sit in each group, which catalog
//     categories those products are in, and whether the group is a stray
//     (no catalog category maps to it; e.g. "Floral Papers" next to
//     "Florals/Gifts / Papers").
//  3. Products — each product whose Erply group disagrees with its catalog
//     category, with the group it should move to in Erply (the catalog owns
//     categories: 2026-11-24 decision, see lib/catalog-erply-group.ts), plus
//     a "name suggests" flag where the product's own name points at a
//     different catalog category, i.e. the catalog may be the one that's
//     wrong.
import path from 'path'
import { config } from 'dotenv'
import XLSX from 'xlsx'

config({ path: path.join(process.cwd(), '.env.local'), quiet: true })

const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'data/category-cleanup.xlsx'

// Name keyword -> the catalog category it points at. Deliberately narrow:
// a hit is a prompt to look, not a verdict.
const NAME_HINTS: Array<[RegExp, string]> = [
  [/\bplush(ie)?\b/i, 'Plush'],
  [/\bkey ?chains?\b/i, 'Keychains'],
  [/\b(tumblers?|mugs?|cups?|water bottles?)\b/i, 'Drinkware & Cups'],
  [/\bribbons?\b/i, 'Ribbons'],
  [/\b(gift )?bows?\b/i, 'Bows'],
  [/\bfloral papers?\b|\bwrapping papers?\b/i, 'Papers'],
  [/\b(pens?|pencils?|notebooks?|erasers?|sharpeners?)\b/i, 'Stationery & Office'],
  [/\blamps?\b/i, 'Lamps'],
  [/\bumbrellas?\b/i, 'Umbrella'],
  [/\bcandles?\b/i, 'Candles'],
  [/\bleis?\b/i, 'Leis'],
  [/\bcrowns?\b/i, 'Crowns'],
  [/\b(slime|squishy|squishies|fidgets?|bubbles?)\b/i, 'Toys & Novelties'],
  [/\bforever roses?\b/i, 'Forever Roses'],
  [/\b(picture|photo) frames?\b/i, 'Picture Frames'],
  [/\bmirrors?\b/i, 'Beauty & Personal Care'],
  [/\bhand fans?\b|\bfans?\b/i, 'Fan'],
]

;(async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { getErplyProducts, getErplyProductGroups } = await import('../lib/erply')
  const { resolveErplyCategoryAlias } = await import('../lib/erply-category-aliases')
  const { erplyGroupForCategory, groupLabelMatches, groupNameSuffixes } = await import('../lib/catalog-erply-group')
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  const { data: cats, error: catErr } = await db.from('categories').select('id, name').order('name')
  if (catErr) throw catErr
  const catName = new Map(cats!.map((c) => [c.id as string, c.name as string]))
  const products: { sku: string; name: string; category_id: string | null; is_active: boolean; manually_hidden: boolean | null }[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from('products').select('sku, name, category_id, is_active, manually_hidden').order('id').range(f, f + 999)
    if (error) throw error
    products.push(...(data as typeof products))
    if (data!.length < 1000) break
  }
  const visible = (p: (typeof products)[number]) => p.is_active && !p.manually_hidden

  console.log('Reading Erply products and groups…')
  const [erplyProducts, groups] = await Promise.all([getErplyProducts(), getErplyProductGroups()])
  const erplyBySku = new Map(erplyProducts.map((p) => [p.sku.toUpperCase(), p]))
  const isLeafOf = (label: string, groupName: string) => groupLabelMatches(label, groupName)

  // ── 1. Catalog categories ──────────────────────────────────────────────
  const catRows = cats!.map((c) => {
    const inCat = products.filter((p) => p.category_id === c.id)
    const live = inCat.filter(visible).length
    const group = erplyGroupForCategory(c.name, groups)?.name ?? ''
    const suggested =
      inCat.length === 0
        ? 'Delete (no products)'
        : live === 0
          ? 'Hide from menu or merge (no visible products)'
          : live <= 3
            ? 'Consider merging (3 or fewer visible)'
            : 'Keep'
    return { Category: c.name, 'All products': inCat.length, Visible: live, 'Erply group': group, Suggested: suggested }
  })

  // ── 3. Products (built before 2, which summarises it) ───────────────────
  const productRows: Record<string, string | number>[] = []
  for (const p of products) {
    const e = erplyBySku.get(p.sku.toUpperCase())
    const cat = p.category_id ? catName.get(p.category_id) ?? '' : ''
    const hints = NAME_HINTS.filter(([re]) => re.test(p.name)).map(([, c]) => c)
    // A name that also fits its current category ("3D Printed Dragon
    // Keychain" in 3D Printed, "Plush Keychain" in Keychains) isn't flagged.
    const fitsCurrent = hints.includes(cat) || (cat && p.name.toLowerCase().includes(cat.toLowerCase().replace(/s$/, '')))
    const nameDisagrees = hints.length && cat && !fitsCurrent ? hints[0] : ''
    if (!e) continue
    const erplyAsCategory = resolveErplyCategoryAlias(e.categoryName)
    const groupAgrees = cat && erplyAsCategory.toLowerCase() === cat.toLowerCase()
    if (groupAgrees && !nameDisagrees) continue
    const target = cat ? erplyGroupForCategory(cat, groups)?.name ?? '' : ''
    // Already in the target group under its leaf name (e.g. "Tumblers" for
    // Drinkware & Cups) counts as agreeing.
    if (!nameDisagrees && target && isLeafOf(target, e.categoryName)) continue
    productRows.push({
      SKU: p.sku,
      Name: p.name,
      Visible: visible(p) ? 'yes' : 'no',
      'Catalog category': cat || '(none)',
      'Erply group': e.categoryName || '(none)',
      'Suggested Erply group': target,
      'Name suggests': nameDisagrees,
    })
  }
  productRows.sort((a, b) => String(a['Catalog category']).localeCompare(String(b['Catalog category'])) || String(a.SKU).localeCompare(String(b.SKU)))

  // ── 2. Erply groups ─────────────────────────────────────────────────────
  const mappedGroups = new Set(cats!.map((c) => erplyGroupForCategory(c.name, groups)?.name).filter(Boolean))
  // The group label a product's groupName belongs to: the longest label it
  // matches, so "Squishy / Slime" goes to "Toys / Squishy / Slime".
  const ownerOf = (groupName: string) =>
    groups.filter((g) => isLeafOf(g.name, groupName)).sort((a, b) => b.name.length - a.name.length)[0]?.name
  const groupRows = groups.map((g) => {
    // Longest label wins: a product in "Squishy / Slime" belongs to
    // "Toys / Squishy / Slime", not to a group whose leaf is just "Slime".
    const inGroup = erplyProducts.filter((p) => isLeafOf(g.name, p.categoryName) && ownerOf(p.categoryName) === g.name)
    const where = new Map<string, number>()
    for (const ep of inGroup) {
      const sp = products.find((p) => p.sku.toUpperCase() === ep.sku.toUpperCase())
      const c = sp?.category_id ? catName.get(sp.category_id) ?? '(none)' : sp ? '(none)' : '(not in catalog)'
      where.set(c, (where.get(c) ?? 0) + 1)
    }
    const top = [...where].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c} ${n}`).join(', ')
    const isParent = groups.some((o) => o.name.startsWith(`${g.name} / `))
    const aliasTargets = groupNameSuffixes(g.name).map((s) => resolveErplyCategoryAlias(s).toLowerCase())
    const reachable = isParent || g.name === 'Default group' || mappedGroups.has(g.name) || cats!.some((c) => aliasTargets.includes(c.name.toLowerCase()))
    return {
      'Erply group': g.name,
      'Erply products': inGroup.length,
      'Their catalog categories': top,
      Stray: reachable ? '' : 'yes',
      Suggested: isParent ? 'Keep (parent group)' : g.name === 'Default group' ? 'Keep (Erply default)' : inGroup.length === 0 ? (reachable ? 'Keep (empty)' : 'Delete (empty stray)') : reachable ? 'Keep' : 'Move products to their category’s group, then delete',
    }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows), 'Catalog categories')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(groupRows), 'Erply groups')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productRows), 'Products')
  XLSX.writeFile(wb, OUT)

  const count = (rows: Record<string, unknown>[], col: string, val?: string) =>
    rows.filter((r) => (val ? String(r[col]).startsWith(val) : r[col])).length
  console.log(`Wrote ${OUT}`)
  console.log(`Catalog categories: ${catRows.length} — ${count(catRows, 'Suggested', 'Delete')} empty, ${count(catRows, 'Suggested', 'Hide')} with nothing visible, ${count(catRows, 'Suggested', 'Consider')} with ≤3 visible`)
  console.log(`Erply groups: ${groupRows.length} — ${count(groupRows, 'Stray')} strays (${groupRows.filter((r) => r.Stray && r['Erply products']).length} still holding products)`)
  console.log(`Products: ${productRows.length} where Erply's group disagrees with the catalog or the name points elsewhere — ${count(productRows, 'Name suggests')} name flags`)
})()
