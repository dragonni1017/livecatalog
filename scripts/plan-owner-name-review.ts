// plan-owner-name-review.ts
// Run with: node scripts/plan-owner-name-review.ts [out.xlsx]
//
// Builds the owner's review workbook (default
// data/product-name-fixes-for-owner.xlsx) from the problems found while
// writing photo descriptions (docs/memory/project-descriptions-no-source-20261026.md).
// READ-ONLY against the database; writes only the workbook.
//
// Input: the `check` column of data/description-pilot.csv and
// data/description-batch-02..41.csv, one note per product whose photo, label
// or QuickBooks text disagreed with the name. Each flag is re-read against the
// LIVE name, so anything renamed since (the 2026-10-27 rounds) drops out.
//
// Sheets:
//  - Name fixes: FIXES below, one exact edit per row applied to the live name
//    to make the suggestion (blank when the photo doesn't settle it), plus a
//    sweep of every visible "Brown Bear" name, which the photos show are
//    capybaras.
//  - Case counts: flags where label, name and QuickBooks give different
//    counts. No suggestion: only the owner/warehouse knows the true count.
//  - Other checks: OTHER below (QuickBooks text, categories, photo labels,
//    sizes).
//  - Need new photo: the products left out of the description batches.
//
// Every suggestion is a human call recorded here with its reason. Once the
// owner returns the sheet, the approved rows become a sku,expect,to,why plan
// for scripts/fix-product-names.ts --plan=..., whose expect-guard skips any
// name that changed after this workbook was made.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })
const dest = path.resolve(ROOT, process.argv[2] ?? 'data/product-name-fixes-for-owner.xlsx')

type Flag = { batch: string; sku: string; id: string; nameThen: string; check: string; fromPhoto: string }
type Live = { id: string; sku: string; name: string; is_active: boolean; manually_hidden: boolean | null }

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---- read the flags from the batch files ----
const batchFiles = ['description-pilot.csv', ...Array.from({ length: 40 }, (_, i) => `description-batch-${String(i + 2).padStart(2, '0')}.csv`)]
const allFlags: Flag[] = []
for (const f of batchFiles) {
  const p = path.join(ROOT, 'data', f)
  if (!fs.existsSync(p)) { console.error(`missing ${f}`); continue }
  const wb = XLSX.read(fs.readFileSync(p, 'utf8'), { type: 'string' })
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  for (const r of rows) {
    const check = String(r.check ?? '').trim()
    if (!check) continue
    allFlags.push({ batch: f, sku: r.sku, id: r.id, nameThen: r.current_name ?? r.name ?? '', check, fromPhoto: r.from_photo ?? '' })
  }
}

const isVisible = (p: Live) => p.is_active && !p.manually_hidden
async function liveBy(col: 'id' | 'sku', keys: string[]): Promise<Map<string, Live>> {
  const m = new Map<string, Live>()
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await db.from('products').select('id,sku,name,is_active,manually_hidden').in(col, keys.slice(i, i + 200))
    if (error) throw error
    for (const d of data as Live[]) if (isVisible(d)) m.set(d[col], d)
  }
  return m
}

const liveById = await liveBy('id', [...new Set(allFlags.map(f => f.id))])
// Still open = still visible and not renamed since the batch saw it.
const flags = allFlags.filter(f => liveById.get(f.id)?.name === f.nameThen)
const firstFlag = new Map<string, Flag>()
for (const f of flags) if (!firstFlag.has(f.sku)) firstFlag.set(f.sku, f)

// ---- 1. Name fixes: [sku, problem, find, replace, why] ----
// find = null means the photo doesn't settle the name: the owner writes it.
type Fix = [string, string, string | RegExp | null, string, string]
const FIXES: Fix[] = [
  // spelling
  ['E273136', 'Spelling', /\bErase\b/, 'Eraser', '"Erase" should be "Eraser"'],
  ['E273134', 'Spelling', 'Monter', 'Monster', '"Monter" should be "Monster"'],
  ['3D801248', 'Spelling', 'Turlte', 'Turtle', '"Turlte" should be "Turtle"'],
  ['G333166', 'Spelling', 'Rectaungular', 'Rectangular', '"Rectaungular" should be "Rectangular"'],
  ['G333167', 'Spelling', 'Rectaungular', 'Rectangular', '"Rectaungular" should be "Rectangular"'],
  ['G333170', 'Spelling', 'Rectaungular', 'Rectangular', '"Rectaungular" should be "Rectangular"'],
  ['B325069', 'Spelling', 'Sequence', 'Sequin', '"Sequence" should be "Sequin"'],
  ['B325105', 'Spelling', 'See-Though', 'See-Through', '"See-Though" should be "See-Through"'],
  ['T642285', 'Spelling', 'Folding Mall Fan', 'Folding Small Fan', '"Mall" is probably "Small"'],
  ['F286938', 'Spelling', 'Flora Paper', 'Floral Paper', '"Flora" should be "Floral"'],
  ['G333158', 'Spelling', 'Rafia', 'Raffia', '"Rafia" should be "Raffia"'],
  ['E273146', 'Spelling', 'Motocycle', 'Motorcycle', '"Motocycle" should be "Motorcycle"'],
  ['T641868', 'Spelling', 'GIft', 'Gift', '"GIft" has a stray capital I'],
  ['P257192', 'Spelling', 'Cristmas', 'Christmas', '"Cristmas" should be "Christmas"'],
  ['T642180', 'Spelling', 'Limbing', 'Bling', '"Limbing" is probably "Bling"'],
  ['T642214', 'Spelling', 'Shapped', 'Shaped', '"Shapped" should be "Shaped"'],
  ['P257207', 'Spelling', 'Cyrstal', 'Crystal', '"Cyrstal" should be "Crystal"'],
  ['P257212', 'Spelling', 'Crsytal', 'Crystal', '"Crsytal" should be "Crystal"'],
  ['S121030', 'Spelling', 'Dumbling', 'Dumpling', '"Dumbling" should be "Dumpling"'],
  ['S121034', 'Spelling', 'Dumbling', 'Dumpling', '"Dumbling" should be "Dumpling"'],
  ['S121035', 'Spelling', 'Dumbling', 'Dumpling', '"Dumbling" should be "Dumpling"'],
  ['S162815', 'Spelling', /Dumbling\s*$/, 'Dumpling', '"Dumbling" should be "Dumpling" (also a trailing space)'],
  ['P257189', 'Spelling', 'PIneapple', 'Pineapple', '"PIneapple" has a stray capital I'],
  ['K229510', 'Spelling', 'Three-colo ', 'Three-Color ', '"Three-colo" is cut short'],
  ['F287906', 'Spelling', 'Lavedar', 'Lavender', '"Lavedar" should be "Lavender"'],
  ['T641790', 'Cut off', /4 Assorted C\.\.\./, '4 Assorted Colors', 'Name is cut off at "4 Assorted C..."'],
  // leftover text
  ['T641716', 'Leftover text', 'XR009) (', '', 'Name starts with stray "XR009) ("'],
  ['P273623', 'Leftover text', /Plush\s+–\s*/, 'Plush ', 'Stray dash after "Plush"'],
  ['F287881', 'Leftover text', ' - 120psc/cs', '', 'Leftover "120psc/cs" in the middle of the name'],
  ['T641209', 'Leftover text', '-50bg/cs', '', 'Leftover "-50bg/cs" (also see the Case counts sheet)'],
  ['F287154', 'Leftover text', null, '', 'Leftover "9*6.06*1.5 24ea"; owner to say how the size should read'],
  ['F287155', 'Leftover text', null, '', 'Leftover "11*7.8*1.58"; owner to say how the size should read'],
  ['F287156', 'Size', null, '', 'Name says 7.5*4*7.1; label says 7.5 x 4.5 x 1.5'],
  // feet written for inches, sizes
  ['D701047', 'Feet for inches', "16'", '16"', "16' means feet; the label says 16\" x 12\""],
  ['P273676-L', 'Feet for inches', "12'", '12"', "12' means feet; should be inches"],
  ['P273701', 'Feet for inches', "10'", '10"', "10' means feet; should be inches"],
  ['P273725', 'Feet for inches', "20'", '20"', "20' means feet. The label says 13.5\", so the size itself may also be wrong"],
  ['P273690', 'Size', '40m', '40cm', '"40m" should be "40cm" (label says 14", QuickBooks 25cm)'],
  // the name says something the photo doesn't show
  ['K229475', 'Wrong animal', 'Mini Bear', 'Mini Puppy', 'Photo shows puppies holding roses'],
  ['P273856', 'Wrong animal', 'Husky Weighted Panda', 'Husky Weighted', 'It is a husky, not a panda'],
  ['P257181', 'Wrong animal', 'Mixed Animal', 'Unicorn', 'Photo and box show only unicorns'],
  ['S146905', 'Wrong animal', 'Monkey', 'Bear', 'Faces look like bears, not monkeys'],
  ['S146893', 'Wrong animal', 'Squirrel', 'Chick', 'Photo looks like a chick'],
  ['K229410', 'Wrong shape', "Starfish Keychain's", 'Seashell Keychains', 'Charms are seashells, not starfish'],
  ['P273740-30cm-CHK', 'Wrong animal', 'Deer Hoodie', 'Pineapple Hoodie', 'Hood looks like a pineapple'],
  ['P273740-40cm-CHK', 'Wrong animal', 'Deer Hoodie', 'Pineapple Hoodie', 'Hood looks like a pineapple'],
  ['P257222', 'Wrong animal', null, '', 'Name says bear; the face has a horn (unicorn-cat)'],
  ['P257260', 'Wrong animal', null, '', 'Name says puppy; the face looks like a bear or cat'],
  ['3D801313', 'Wrong animal', null, '', 'Name says dino; photo looks like a shaggy horned cow or yak'],
  ['T641884', 'Wrong animal', null, '', 'Name says unicorn; the bottle has no horn'],
  ['T641221', 'Wrong product', 'Robot', 'Rainbow Spaceman Push Pop Board', 'Photo is a giant push-pop board, not a robot'],
  ['P257311', 'Wrong product', 'Fur Notebook With Color Pencils', 'Fur Pencil Case Stationery Set', 'Photo is a pencil case filled with stationery'],
  ['S162776', 'Wrong product', 'Candy Squishy', 'Crystal Squish Stretch Ball', 'Box says Crystal Squish Stretch Ball'],
  ['S162591', 'Wrong product', 'Colorchainging Slime Ball', 'Glow in the Dark Slime Ball', 'Box says Glow in the Dark Tofu Balls (and "Colorchainging" is misspelled)'],
  ['P273854', 'Wrong product', 'Water Chestnut', 'Calla Lily', 'Flowers look like calla lilies'],
  ['T642233', 'Wrong product', 'Leather Patch', 'Compact Mirror', 'It is a compact mirror'],
  ['T642234', 'Wrong product', 'Leather Patch', 'Compact Mirror', 'It is a compact mirror'],
  ['T642235', 'Wrong product', 'Leopart Print Leather Patch', 'Leopard Print Compact Mirror', 'It is a compact mirror (and "Leopart" is misspelled)'],
  ['T642236', 'Wrong product', 'Rectangular Fish Scale Pattern', 'Rectangular Fish Scale Pattern Compact Mirror', 'Name is missing what it is (a compact mirror)'],
  ['T641581', 'Wrong product', 'Single Plate', 'Single Bowl', 'Photo and box show a bowl'],
  ['T641585', 'Wrong product', 'Single Plate', 'Single Bowl', 'Photo and box show a bowl'],
  ['T641586', 'Wrong product', 'Single Plate', 'Single Bowl', 'Photo and box show a bowl'],
  ['T641588', 'Wrong product', 'Single Plate', 'Single Bowl', 'Photo and box show a bowl'],
  ['T641593', 'Wrong product', 'Single Plate', 'Single Bowl', 'Photo and box show a bowl'],
  ['B325101', 'Wrong product', 'Backpack', 'Handbag', 'Photo shows a handbag with top handles'],
  ['B325088', 'Wrong product', 'Hand Clutch', 'Shoulder Bag', 'Photo shows a long chain shoulder strap'],
  ['P273766', 'Wrong product', 'Sneaker', 'Slipper', 'They are slippers, not sneakers'],
  ['D701115', 'Wrong product', 'Hair Clipper Set', 'Hair Clip Set', '"Hair Clipper" reads like a trimmer; these are hair clips'],
  ['P273710', 'Wrong product', 'Headband', 'Wristband', 'Photo shows them worn on the wrist'],
  ['IC44200', 'Wrong product', 'Green Glitter Bottle', 'Green Craft Glitter Bottle', 'It is craft glitter; it is also filed under Drinkware (see Other checks)'],
  ['S146946', 'Too vague', /^Slime$/, 'Bear Bottle Crystal Slime', 'Name is just "Slime"'],
  ['T642241', 'Wrong print', 'Spraying Painting Color', 'Floral Mesh', 'Print is lace; QuickBooks calls it Floral Mesh'],
  ['B325120', 'Wrong count', '2 Style ', '', 'Photo shows only one style'],
  ['K229520', 'Wrong count', '4 color', '6 Color', 'Photo shows 6 colors'],
  ['F286610', 'Wrong count', null, '', 'Name says four colors; photo shows two'],
  ['C801021', 'Wrong count', null, '', 'Name says 3 colors; photo shows one (also filed under Drinkware)'],
  ['F287772', 'Duplicate name', 'Matte Light Purple', 'Matte Deep Purple', 'Same name as F287773; this one is deep purple'],
  ['F286984', 'Duplicate name', null, '', 'Same name as F286983 (the black one); this one is white'],
  ['PF20200931-WT', 'Duplicate listing', null, '', 'Same paper as PF20200931 (whose photo label reads PF20200931-WT). Keep one?'],
  // the color in the name doesn't match the photo
  ['F287432', 'Color', 'Brown', 'Natural', 'Photo shows natural tan and white'],
  ['F287433', 'Color', 'Brown', 'Natural', 'Photo shows natural tan and white'],
  ['F287535', 'Color', null, '', 'Name says Gray; photo shows white and gray'],
  ['F286543', 'Color', null, '', 'Name says RED; photo shows hot pink roses'],
  ['F286921', 'Color', 'Purple Rose', 'Pink Rose', 'Photo shows pink roses'],
  ['F286940', 'Color', null, '', 'Name says red and peach; photo shows hot pink and light pink ("Flora" is also misspelled)'],
  ['F287660', 'Color', 'Dark Red', 'Brown', 'Photo looks brown'],
  ['FD250019', 'Color', 'Light Green', 'Green', 'Photo looks mid/kelly green'],
  ['FD400019', 'Color', 'Light Green', 'Green', 'Photo looks mid green'],
  ['F287146', 'Color', null, '', 'Name says burgundy; glitter looks bright red-pink'],
  ['K229414', 'Color', 'Pink & White', 'Pink & Black', 'Photo shows black and pink'],
  ['FD400109', 'Color', 'Cream', 'Peach', 'Looks peach'],
  ['FD400065', 'Color', 'Dark Red', 'Raspberry', 'Looks raspberry pink'],
  ['F287747', 'Color', 'Dark Purple', 'Lavender', 'Looks light lavender'],
  ['F287738', 'Color', 'Red Frosted', 'Rose Pink Frosted', 'Sheet looks rose pink with a red trim'],
  ['F287826', 'Color', 'Light Green', 'Taupe', 'Looks taupe'],
  ['F287976', 'Color', 'Light Grey', 'Mauve', 'Looks dusty mauve'],
  ['F287979', 'Color', 'Light Cream', 'Tan', 'Looks tan kraft'],
  ['F287981', 'Color', 'Salmon', 'Rose Pink', 'Looks rose pink'],
  ['F287989', 'Color', 'Lavender Light Purple', 'Lavender White', 'Sheet looks white'],
  ['F288013', 'Color', null, '', 'Named "Gold Dotted"; the hearts in the photo look red'],
  ['F288014', 'Color', null, '', 'Named "Gold Dotted"; the hearts in the photo look red'],
  ['F287859', 'Pattern', null, '', 'Name says butterfly; the border shows flowers'],
  ['F287792', 'Pattern', null, '', 'Name says butterfly print; cut-outs show birds and hearts'],
  ['T642163', 'Pattern', null, '', 'Name says floral; photo shows mostly butterflies'],
]

// ---- 3. Other checks: sku -> [type, question] ----
const OTHER: Record<string, [string, string]> = {
  C266032: ['Food', 'Check the ingredients and allergen wording before publishing'],
  D701083: ['Size', 'Name says 3.2 inch; photo says 3"'],
  F561935: ['Unclear name', '"5 Features" is not visible in the photo'],
  F286501: ['Photo variant', 'Photo is the -BLK variant; confirm this SKU is black'],
  F287415: ['Pack', 'Photo shows red and pink together; is a pack mixed?'],
  F287475: ['Photo label', 'Photo label says F287472 (red) but shows a white bow'],
  '3D801155': ['Size', 'Label 17.7", name 20"'],
  IC44200: ['Category', 'Craft glitter filed under Drinkware & Cups'],
  P257236: ['Category', 'Photo shows paper gift bags; filed under Bags/Purses'],
  C801021: ['Category', 'Make-up brushes filed under Drinkware & Cups'],
  'B325084-Backpack': ['Unclear name', 'Leash in the name is not visible'],
  F286894: ['Unclear name', 'Clear lid in the name is not visible'],
  F286893: ['Unclear name', 'Clear lid in the name is not visible'],
  T641941: ['Unclear name', 'Speaker not visible; label size 12 x 4 x 3 looks wrong for a 40oz mug'],
  T641015: ['QuickBooks', 'QuickBooks has a second T641015 entry named "Umbrella Unicorn"'],
  G333144: ['Photo variant', 'Photo label (180/cs, 12.5") looks like the medium size, not Small'],
  '3D801232': ['QuickBooks', 'QuickBooks says 68/cs (probably 168)'],
  F287542: ['QuickBooks', 'QuickBooks sales description is just the UPC'],
  K229420: ['QuickBooks', 'QuickBooks text says "Soccer Bling Keychain" (swapped with K229440)'],
  K229440: ['QuickBooks', 'QuickBooks text says "Open Heart Bling Keychain" (swapped with K229420)'],
  F286631: ['QuickBooks', 'QuickBooks text says "Heart Shape Box Set with Clear Top - 16/cs"'],
  P273689: ['QuickBooks', 'QuickBooks says 36cm and 36/cs; label and name say 48/cs'],
  F287300: ['QuickBooks', 'QuickBooks says red; photo shows red, purple and pink'],
  F287297: ['QuickBooks', 'QuickBooks says pink & red; photo also shows purple'],
  F287298: ['QuickBooks', 'QuickBooks says red; photo shows pink, red and purple'],
  'P273810-60cm': ['Photo variant', 'Photo is the 46cm item; this SKU needs its own photo'],
  'S121030-25CM': ['Photo variant', 'Photo is the small S121030'],
  'P273803-60cm': ['Photo variant', 'Photo is the 46CM size'],
  'P273819-45CM': ['Photo variant', 'Photo is the small P273819'],
  'P273836-60CM': ['Photo variant', 'Photo is the 46CM size'],
  'P273647-50CM-CHK': ['Photo variant', 'Name says 20" (50cm); photo label is the 16" P273647'],
  'F286809-GR': ['Photo variant', 'Photo shows the black set (F286809-BLK)'],
  F287969: ['Photo variant', 'Photo shows white, black and pink sets for this black item'],
  G333155: ['Photo variant', 'G333153 "Floral Pattern" photo showed gold dots; may belong to this bag'],
  B325097: ['Photo label', 'Photo label reads B425097'],
  K229438: ['Photo label', 'Photo label reads K229430'],
  'P273777-40cm': ['Photo label', 'Photo label reads P273776-40cm'],
  K229468: ['Photo label', 'Photo label reads K229467'],
  T641666: ['Photo label', 'Photo label reads T641166'],
  K229381: ['Photo label', 'Photo label reads K299381'],
  K229475: ['Photo label', 'Photo label reads K329475'],
  T642034: ['Photo label', 'Photo label is blacked out'],
  P251933: ['Size', 'Label 13" tall, name 14"'],
  'P273676-100cm': ['Size', 'Label 32", name 100cm (39")'],
  T641667: ['Size', 'Label 19.3", name 21"'],
  F288019: ['Size', 'Name 11 1/4", label 12"'],
  'P273815-60cm': ['Size', 'Label 27.5", name 24 inch'],
  T641790: ['Size', 'Label 40", name 75cm (29.5 in)'],
  '3D801241': ['Size', 'Label says 2.4" x 0.7" for a "Large" item; what is the real size?'],
  '3D801249': ['Size', 'Label says 1.4" x 0.6", which looks too small; what is the real size?'],
  '3D801254': ['Size', 'Label says 0.6 x 0.6; unclear what it measures'],
  '3D801261': ['Size', 'Label size could not be used; what is the real size?'],
}

// ---- 4. Left out of the description batches for a wrong/blurry photo ----
const PHOTO_SKUS = ['D701004', 'D701018', 'D701098', 'D701114', 'E273127', 'F286809', 'F286877-2', 'F286965', 'F287429', 'F287526', 'F287575', 'F561926', 'H424270', 'K229473', 'LL666', 'P257216', 'P257251', 'P273606-2', 'P273668', 'P273807-25CM', 'S162757', 'T641505']

// ---- 2. Case counts: flags about counts, minus ones that are QuickBooks text or photo notes ----
const NOT_CASE = new Set(['F287300', 'F287297', 'F287298', 'P273689'])
const CASE_RE = /\b(case|pack)\b|\d+\/pk|\/cs|cs\.|count|boxes|bxs|pks|per display|displays/i
const PHOTO_NOTE_RE = /^Uses the|^Photo is|WRONG PHOTO|NO DESCRIPTION|needs a better/i
const caseFlags = flags.filter(f => CASE_RE.test(f.check) && !NOT_CASE.has(f.sku) && !PHOTO_NOTE_RE.test(f.check))

// "Brown Bear" sweep. P273826 "Pineapple Brown Bear" really is a teddy bear.
const { data: bb, error: bbErr } = await db.from('products').select('id,sku,name,is_active,manually_hidden').ilike('name', '%brown bear%')
if (bbErr) throw bbErr
const brown = (bb as Live[]).filter(p => isVisible(p) && p.sku !== 'P273826').sort((a, b) => a.sku.localeCompare(b.sku))
const seenBrown = new Set(flags.filter(f => /brown bear|capybara/i.test(f.check)).map(f => f.sku))

const live = await liveBy('sku', [...new Set([...FIXES.map(f => f[0]), ...caseFlags.map(f => f.sku), ...Object.keys(OTHER), ...PHOTO_SKUS])])
const problems: string[] = []

const nameRows: Record<string, string>[] = []
const nameRow = (sku: string, name: string, problem: string, why: string, to: string) =>
  nameRows.push({ SKU: sku, 'Current name': name, Problem: problem, 'What we found': why, 'Suggested name': to, 'OK? (Y/N)': '', 'Your name instead': '', Notes: '' })
for (const [sku, problem, find, rep, why] of FIXES) {
  const l = live.get(sku)
  if (!l) { problems.push(`${sku}: not visible`); continue }
  let to = ''
  if (find !== null) {
    to = l.name.replace(find, rep).replace(/\s{2,}/g, ' ').trim()
    if (to === l.name) { problems.push(`${sku}: edit does not match the live name`); to = '' }
  }
  nameRow(sku, l.name, problem, why, to)
}
for (const p of brown) {
  const to = p.name.replace(/"?Brown Bear"?/i, 'Capybara').replace(/\s{2,}/g, ' ').trim()
  const why = seenBrown.has(p.sku)
    ? 'Photo shows a capybara (one display box in this line is printed "CAPY BARA")'
    : 'Same "Brown Bear" naming as the capybara items; photo not checked one by one'
  nameRow(p.sku, p.name, 'Brown Bear = capybara', why, to)
}
const order = ['Spelling', 'Cut off', 'Leftover text', 'Feet for inches', 'Size', 'Wrong product', 'Wrong animal', 'Wrong shape', 'Wrong print', 'Too vague', 'Wrong count', 'Duplicate name', 'Duplicate listing', 'Color', 'Pattern', 'Brown Bear = capybara']
nameRows.sort((a, b) => order.indexOf(a.Problem) - order.indexOf(b.Problem) || a.SKU.localeCompare(b.SKU))

const caseRows: Record<string, string>[] = []
const seenCase = new Set<string>()
for (const f of caseFlags) {
  const l = live.get(f.sku)
  if (!l || seenCase.has(f.sku)) continue
  seenCase.add(f.sku)
  caseRows.push({ SKU: f.sku, 'Current name': l.name, 'What disagrees': f.check.replace(/^(CASE|PACK|NAME|SIZE|QUICKBOOKS):\s*/i, ''), 'Photo label says': f.fromPhoto, 'Correct count': '', Notes: '' })
}
caseRows.sort((a, b) => a.SKU.localeCompare(b.SKU))

const otherRows: Record<string, string>[] = []
for (const [sku, [type, what]] of Object.entries(OTHER)) {
  const l = live.get(sku)
  if (!l) { problems.push(`${sku}: not visible (other checks)`); continue }
  otherRows.push({ SKU: sku, 'Current name': l.name, Type: type, 'What to check': what, Answer: '' })
}
otherRows.sort((a, b) => a.Type.localeCompare(b.Type) || a.SKU.localeCompare(b.SKU))

const photoRows = PHOTO_SKUS.map(sku => ({
  SKU: sku,
  'Current name': live.get(sku)?.name ?? '(not visible)',
  'Problem with the photo': firstFlag.get(sku)?.check ?? 'Photo is wrong or unclear',
  'New photo uploaded? (Y/N)': '',
}))

const readme = [
  ['Product name fixes for review'],
  [''],
  ['While writing product descriptions from photos, each photo, its label and QuickBooks were compared with the product name.'],
  ['These sheets list what did not match. Nothing here has been changed yet: every rename needs your OK.'],
  [''],
  ['Name fixes', 'Suggested renames. Put Y in "OK?" to accept the suggestion, N to leave the name alone, or type a different name in "Your name instead". Rows with no suggestion need you to write the name.'],
  ['Case counts', 'The label, the name and QuickBooks give different counts. Write the correct pieces per case (and per pack if it matters).'],
  ['Other checks', 'QuickBooks text, categories, photo labels and sizes that look wrong. Write what is correct in "Answer".'],
  ['Need new photo', 'Products whose photo is wrong, blurry or shows a different item. They have no description until a new photo is uploaded.'],
  [''],
  ['Approved renames are applied to Erply, WooCommerce and the catalog together, and only if the name has not changed since this list was made.'],
]

const wb = XLSX.utils.book_new()
function addSheet(name: string, ws: XLSX.WorkSheet, widths: number[], filter: boolean) {
  ws['!cols'] = widths.map(wch => ({ wch }))
  if (filter && ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] }
  XLSX.utils.book_append_sheet(wb, ws, name)
}
addSheet('Read me', XLSX.utils.aoa_to_sheet(readme), [18, 140], false)
addSheet('Name fixes', XLSX.utils.json_to_sheet(nameRows), [16, 60, 20, 55, 60, 9, 40, 30], true)
addSheet('Case counts', XLSX.utils.json_to_sheet(caseRows), [16, 60, 70, 45, 16, 30], true)
addSheet('Other checks', XLSX.utils.json_to_sheet(otherRows), [16, 60, 14, 70, 40], true)
addSheet('Need new photo', XLSX.utils.json_to_sheet(photoRows), [16, 60, 70, 14], true)
fs.mkdirSync(path.dirname(dest), { recursive: true })
// The ESM build of xlsx has no fs hooked up, so write the buffer ourselves.
fs.writeFileSync(dest, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer)

console.log(`flags read: ${allFlags.length}, still open: ${flags.length}`)
console.log(`Name fixes ${nameRows.length} (${nameRows.filter(r => r['Suggested name']).length} with a suggestion, ${brown.length} Brown Bear)`)
console.log(`Case counts ${caseRows.length}, Other checks ${otherRows.length}, Need new photo ${photoRows.length}`)
console.log(`wrote ${path.relative(ROOT, dest)}`)
if (problems.length) console.log(`CHECK:\n  ${problems.join('\n  ')}`)
