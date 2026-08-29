/**
 * unit-lib.js — shared helpers for audit-units.js / cleanup-units.js
 * READ-ONLY helpers. No DB writes here.
 *
 * UNIT_NAME_MAP is parsed straight out of the frontend source
 * (/opt/crm/frontend/src/utils/unitNormalize.ts) so the scripts can never
 * drift from what the app actually does at runtime.
 */
const fs = require('fs')
const path = require('path')

const NORMALIZE_TS = '/opt/crm/frontend/src/utils/unitNormalize.ts'

// Fallback copy — used only if the .ts file is unreadable.
const FALLBACK_MAP = {
  'กิโลกรัม': 'kg', 'กรัม': 'g', 'มิลลิกรัม': 'mg', 'ขีด': 'hg',
  'ก.ก.': 'kg', 'กก.': 'kg', 'กก': 'kg', 'กิโล': 'kg', 'กรัม.': 'g',
  'ซีซี': 'ml', 'cc': 'ml', 'ปอนด์': 'lb', 'ออนซ์': 'oz',
  'นิ้ว': 'inch', 'เซนติเมตร': 'cm', 'มิลลิเมตร': 'mm',
  'เมตร': 'm', 'กิโลเมตร': 'km', 'ฟุต': 'ft', 'หลา': 'yard',
  'ลิตร': 'l', 'มิลลิลิตร': 'ml', 'แกลลอน': 'gallon',
  'ตารางเมตร': 'm2', 'ตารางเซนติเมตร': 'cm2',
  'ชิ้น': 'pcs', 'โหล': 'dozen', 'โกรส': 'gross', 'คู่': 'pair',
  'กล่อง': 'box', 'แพ็ค': 'pack', 'แพ๊ค': 'pack', 'แพค': 'pack',
  'ชุด': 'set', 'ม้วน': 'roll', 'แผ่น': 'sheet', 'ขวด': 'bottle',
  'ถุง': 'bag', 'ซอง': 'sachet', 'ลัง': 'case', 'กระป๋อง': 'can',
  'หลอด': 'tube', 'เม็ด': 'tablet', 'แก้ว': 'glass',
  'ช้อนชา': 'tsp', 'ช้อนโต๊ะ': 'tbsp', 'มล.': 'ml', 'จาน': 'plate',
  'ถาด': 'tray', 'ลูก': 'piece', 'ฟอง': 'egg', 'รายการ': 'item',
  'สกู๊ป': 'scoop', 'กุรอส': 'gross',
}

function loadUnitNameMap() {
  try {
    const src = fs.readFileSync(NORMALIZE_TS, 'utf8')
    const body = src.slice(src.indexOf('{'), src.indexOf('}') + 1)
    const map = {}
    const re = /'([^']+)'\s*:\s*'([^']+)'/g
    let m
    while ((m = re.exec(body))) map[m[1]] = m[2]
    if (Object.keys(map).length > 10) return { map, source: NORMALIZE_TS }
  } catch (_) { /* fall through */ }
  return { map: FALLBACK_MAP, source: '(fallback copy embedded in unit-lib.js)' }
}

const { map: UNIT_NAME_MAP, source: MAP_SOURCE } = loadUnitNameMap()

/** Mirrors frontend normalizeUnit() exactly. */
function normalizeUnit(unit) {
  if (!unit) return unit
  const u = String(unit).toLowerCase().trim()
  const match = u.match(/\(([^)]+)\)$/)
  if (match) return match[1].trim()
  return UNIT_NAME_MAP[u] || u
}

// ── Unit categories ────────────────────────────────────────────────
const CATEGORY = {
  weight: ['mg', 'g', 'hg', 'kg', 'ton', 'lb', 'oz'],
  volume: ['ml', 'cc', 'l', 'ltr', 'gallon', 'tsp', 'tbsp', 'cup'],
  length: ['mm', 'cm', 'm', 'km', 'inch', 'ft', 'yard'],
  area: ['m2', 'cm2'],
  count: ['pcs', 'piece', 'dozen', 'gross', 'pair', 'item', 'egg', 'tablet', 'sheet', 'slice', 'slices'],
  container: ['pack', 'box', 'case', 'bag', 'set', 'bottle', 'can', 'sachet', 'tube',
    'roll', 'glass', 'plate', 'tray', 'scoop', 'carton', 'crate', 'drum', 'bundle', 'จาน'],
}
const UNIT_CATEGORY = {}
for (const [cat, units] of Object.entries(CATEGORY)) for (const u of units) UNIT_CATEGORY[u] = cat

function categoryOf(u) { return UNIT_CATEGORY[normalizeUnit(u)] || null }

/**
 * Packaging / count units whose meaning is product-specific.
 * A tenant-wide (global) rule built on one of these is almost always wrong:
 * "1 pack = 12 pcs" for a normal product but "1 pack = 30 eggs" for eggs.
 */
const RISKY_GLOBAL_UNITS = new Set([
  'pack', 'box', 'case', 'bag', 'set', 'carton', 'crate', 'bundle',
  'bottle', 'can', 'sachet', 'tube', 'tray', 'roll', 'glass', 'plate', 'scoop',
])

/** Thai labels for readability in reports. */
const UNIT_LABELS = {
  pcs: 'ชิ้น', kg: 'กิโลกรัม', g: 'กรัม', mg: 'มิลลิกรัม', hg: 'ขีด',
  lb: 'ปอนด์', oz: 'ออนซ์', m: 'เมตร', cm: 'เซนติเมตร', mm: 'มิลลิเมตร',
  km: 'กิโลเมตร', inch: 'นิ้ว', ft: 'ฟุต', yard: 'หลา', l: 'ลิตร',
  ltr: 'ลิตร', ml: 'มิลลิลิตร', gallon: 'แกลลอน', roll: 'ม้วน', box: 'กล่อง',
  pack: 'แพ็ค', set: 'ชุด', pair: 'คู่', sheet: 'แผ่น', bottle: 'ขวด',
  bag: 'ถุง', sachet: 'ซอง', dozen: 'โหล', gross: 'กุรอส', case: 'ลัง',
  can: 'กระป๋อง', tube: 'หลอด', tablet: 'เม็ด', glass: 'แก้ว', tsp: 'ช้อนชา',
  tbsp: 'ช้อนโต๊ะ', plate: 'จาน', tray: 'ถาด', piece: 'ลูก', egg: 'ฟอง',
  item: 'รายการ', scoop: 'สกู๊ป',
}
function ul(u) { return UNIT_LABELS[u] ? `${u} (${UNIT_LABELS[u]})` : u }

/** Every unit code the system knows about (post-normalization). */
const KNOWN_CODES = new Set([
  ...Object.values(UNIT_NAME_MAP),
  ...Object.keys(UNIT_LABELS),
  ...Object.values(CATEGORY).flat(),
])

const STOCK_UNIT_COLS = ['unit', 'base_unit', 'sale_unit', 'display_unit']

function openDb(readonly = true) {
  const Database = require('better-sqlite3')
  const dbPath = path.resolve(__dirname, '..', 'dev.db')
  return { db: new Database(dbPath, { readonly }), dbPath }
}

// ── Analysis core (shared by audit + cleanup so both agree) ────────
function analyze(db) {
  const conversions = db.prepare(
    'SELECT * FROM unit_conversions ORDER BY tenant_id, material_id, from_unit, to_unit'
  ).all()
  const stock = db.prepare(
    'SELECT id, tenant_id, sku, name, unit, base_unit, sale_unit, display_unit FROM stock_items'
  ).all()
  const stockById = new Map(stock.map(s => [s.id, s]))

  const norm = c => ({
    ...c,
    nFrom: normalizeUnit(c.from_unit),
    nTo: normalizeUnit(c.to_unit),
  })
  const rows = conversions.map(norm)

  // 1. redundant identity rows (from and to normalize to the same code)
  const redundantSynonyms = rows.filter(r => r.nFrom === r.nTo)

  // 2. rows whose stored units are not normalized
  const nonNormalized = rows
    .filter(r => r.nFrom !== r.nTo)
    .filter(r => r.from_unit !== r.nFrom || r.to_unit !== r.nTo)

  // 2b. after normalizing, does the row collide with an existing row?
  const key = r => `${r.tenant_id}|${r.material_id || ''}|${r.nFrom}|${r.nTo}`
  const byKey = new Map()
  for (const r of rows) {
    if (r.nFrom === r.nTo) continue
    const k = key(r)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(r)
  }
  const duplicateAfterNormalize = []   // same key, same factor -> safe to drop extras
  const conflictAfterNormalize = []    // same key, different factor -> human decision
  for (const [k, group] of byKey) {
    if (group.length < 2) continue
    const factors = [...new Set(group.map(r => r.conversion_factor))]
    if (factors.length === 1) duplicateAfterNormalize.push({ key: k, group })
    else conflictAfterNormalize.push({ key: k, group, factors })
  }

  // 3. risky global rules based on packaging/count units
  const globals = rows.filter(r => !r.material_id && r.nFrom !== r.nTo)
  const unitUsage = (tenantId, code) => {
    const hits = []
    for (const s of stock) {
      if (s.tenant_id !== tenantId) continue
      const used = STOCK_UNIT_COLS.filter(col => s[col] && normalizeUnit(s[col]) === code)
      if (used.length) hits.push({ sku: s.sku, name: s.name, cols: used })
    }
    return hits
  }
  const riskyGlobals = globals
    .filter(r => RISKY_GLOBAL_UNITS.has(r.nFrom) || RISKY_GLOBAL_UNITS.has(r.nTo))
    .map(r => ({
      row: r,
      affectedFrom: unitUsage(r.tenant_id, r.nFrom),
      affectedTo: unitUsage(r.tenant_id, r.nTo),
      // per-material rules that already override this global for the same pair
      overriddenBy: rows.filter(o =>
        o.material_id && o.tenant_id === r.tenant_id && o.nFrom === r.nFrom && o.nTo === r.nTo),
    }))

  // 4. global rules crossing unit categories
  const crossCategoryGlobals = globals
    .map(r => ({ row: r, catFrom: categoryOf(r.from_unit), catTo: categoryOf(r.to_unit) }))
    .filter(x => x.catFrom && x.catTo && x.catFrom !== x.catTo)

  // 5. stock_items columns holding non-normalized / unknown units
  const stockUnitIssues = []
  for (const s of stock) {
    for (const col of STOCK_UNIT_COLS) {
      const v = s[col]
      if (!v) continue
      const n = normalizeUnit(v)
      if (n !== v) stockUnitIssues.push({ ...s, col, value: v, normalized: n, kind: 'normalize' })
      else if (!KNOWN_CODES.has(n)) stockUnitIssues.push({ ...s, col, value: v, normalized: n, kind: 'unknown' })
    }
  }

  // 6. global vs per-material factor conflicts (material always wins at runtime)
  const globalIndex = new Map()
  for (const g of globals) globalIndex.set(`${g.tenant_id}|${g.nFrom}|${g.nTo}`, g)
  const globalVsMaterial = []
  for (const r of rows) {
    if (!r.material_id || r.nFrom === r.nTo) continue
    const g = globalIndex.get(`${r.tenant_id}|${r.nFrom}|${r.nTo}`)
    if (g && g.conversion_factor !== r.conversion_factor) {
      globalVsMaterial.push({ global: g, material: r, stock: stockById.get(r.material_id) })
    }
  }

  // 6b. inverse-pair inconsistency (A->B and B->A that are not reciprocal)
  const inverseMismatch = []
  const seenPair = new Set()
  for (const r of rows) {
    if (r.nFrom === r.nTo) continue
    const inv = rows.find(o =>
      o.tenant_id === r.tenant_id &&
      (o.material_id || null) === (r.material_id || null) &&
      o.nFrom === r.nTo && o.nTo === r.nFrom)
    if (!inv) continue
    const pk = [r.tenant_id, r.material_id || '', ...[r.nFrom, r.nTo].sort()].join('|')
    if (seenPair.has(pk)) continue
    seenPair.add(pk)
    const product = r.conversion_factor * inv.conversion_factor
    if (Math.abs(product - 1) > 1e-6) inverseMismatch.push({ a: r, b: inv, product })
  }

  // 7. orphan rows (material_id points at a stock item that no longer exists)
  const orphans = rows.filter(r => r.material_id && !stockById.has(r.material_id))

  return {
    conversions: rows, stock, stockById,
    redundantSynonyms, nonNormalized, duplicateAfterNormalize, conflictAfterNormalize,
    riskyGlobals, crossCategoryGlobals, stockUnitIssues,
    globalVsMaterial, inverseMismatch, orphans,
    unitUsage,
  }
}

module.exports = {
  UNIT_NAME_MAP, MAP_SOURCE, normalizeUnit, categoryOf, CATEGORY,
  RISKY_GLOBAL_UNITS, UNIT_LABELS, ul, KNOWN_CODES, STOCK_UNIT_COLS,
  openDb, analyze,
}
