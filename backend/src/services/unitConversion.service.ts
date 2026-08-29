import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import { roundQty } from '../utils/qty'

export interface UnitConversion {
  id: string
  tenant_id: string | null
  material_id: string | null
  from_unit: string
  to_unit: string
  conversion_factor: number
  is_global: number
  notes?: string
  created_at: string
  updated_at: string
}

// ===================================================================
// มาตราสากลที่ระบบรู้จักโดยอัตโนมัติ (ไม่ต้องตั้งค่าเพิ่ม)
// หมายเหตุ: key ต้องเป็น canonical code เสมอ (ผ่าน normalizeUnit แล้ว)
// ===================================================================
const STANDARD_CONVERSIONS: Record<string, number> = {
  // น้ำหนัก
  'kg->g': 1000,
  'g->kg': 0.001,
  'kg->mg': 1_000_000,
  'mg->g': 0.001,
  'g->mg': 1000,
  'lb->kg': 0.453592,
  'kg->lb': 2.20462,
  'oz->g': 28.3495,
  'g->oz': 0.035274,
  // ขีด (hectogram) = 100 กรัม
  'hg->g': 100,
  'g->hg': 0.01,
  'hg->kg': 0.1,
  'kg->hg': 10,

  // ความยาว
  'inch->cm': 2.54,
  'cm->inch': 0.393701,
  'inch->mm': 25.4,
  'mm->inch': 0.0393701,
  'm->cm': 100,
  'cm->m': 0.01,
  'm->mm': 1000,
  'mm->m': 0.001,
  'km->m': 1000,
  'm->km': 0.001,
  'ft->m': 0.3048,
  'm->ft': 3.28084,
  'yard->m': 0.9144,
  'm->yard': 1.09361,
  'yard->cm': 91.44,
  'cm->yard': 0.0109361,

  // ปริมาตร (ltr ถูก canonicalize เป็น l แล้ว จึงไม่ต้องมี key ของ ltr)
  'l->ml': 1000,
  'ml->l': 0.001,
  'gallon->l': 3.78541,
  'l->gallon': 0.264172,
  'fl_oz->ml': 29.5735,
  'ml->fl_oz': 0.033814,

  // พื้นที่
  'm2->cm2': 10000,
  'cm2->m2': 0.0001,

  // หน่วยนับบรรจุภัณฑ์ที่มีค่าตายตัวสากล
  'dozen->pcs': 12,      // โหล = 12 ชิ้น
  'pcs->dozen': 0.083333,
  'gross->pcs': 144,     // กุรอส = 12 โหล = 144 ชิ้น
  'pcs->gross': 0.006944,
  'gross->dozen': 12,
  'dozen->gross': 0.083333,
  'pair->pcs': 2,        // คู่ = 2 ชิ้น
  'pcs->pair': 0.5,
}

// ===================================================================
// Unit Name Mapping (Thai / alias ↔ canonical English code)
// ===================================================================
const UNIT_NAME_MAP: Record<string, string> = {
  // น้ำหนัก
  'กิโลกรัม': 'kg', 'กรัม': 'g', 'มิลลิกรัม': 'mg',
  'ขีด': 'hg',
  'ปอนด์': 'lb', 'ออนซ์': 'oz',
  // ตัวย่อ kg ที่ใช้ทั่วไป
  'ก.ก.': 'kg', 'กก.': 'kg', 'กก': 'kg', 'กิโล': 'kg',
  // ตัวย่อ g ที่ใช้ทั่วไป
  'กรัม.': 'g',
  // ตัวย่อ ml
  'ซีซี': 'ml', 'cc': 'ml',
  // ความยาว
  'นิ้ว': 'inch', 'เซนติเมตร': 'cm', 'มิลลิเมตร': 'mm',
  'เมตร': 'm', 'กิโลเมตร': 'km', 'ฟุต': 'ft', 'หลา': 'yard',
  // ปริมาตร
  'ลิตร': 'l', 'มิลลิลิตร': 'ml', 'แกลลอน': 'gallon',
  // พื้นที่
  'ตารางเมตร': 'm2', 'ตารางเซนติเมตร': 'cm2',
  // sqm/sqcm are spellings of the same units — fold them in so the picker
  // does not offer "ตารางเมตร" twice under two different codes.
  'sqm': 'm2', 'sqcm': 'cm2',
  // หน่วยนับ
  'ชิ้น': 'pcs', 'โหล': 'dozen', 'โกรส': 'gross', 'คู่': 'pair',
  'กล่อง': 'box', 'แพ็ค': 'pack', 'แพ๊ค': 'pack', 'แพค': 'pack',
  'ชุด': 'set', 'ม้วน': 'roll',
  'แผ่น': 'sheet', 'ขวด': 'bottle', 'ถุง': 'bag', 'ซอง': 'sachet',
  'ลัง': 'case', 'กระป๋อง': 'can', 'หลอด': 'tube', 'เม็ด': 'tablet',
  'แก้ว': 'glass', 'ช้อนชา': 'tsp', 'ช้อนโต๊ะ': 'tbsp',
  'มล.': 'ml', 'จาน': 'plate', 'ถาด': 'tray', 'ลูก': 'piece',
  'ฟอง': 'egg', 'รายการ': 'item', 'สกู๊ป': 'scoop',
  'ถัง': 'tank', 'สไลซ์': 'slice',
  // spelling variants ที่พบบ่อย
  'กุรอส': 'gross',
  // ---- alias ภาษาอังกฤษ (วางท้ายสุด เพื่อไม่ให้ชนะ label ภาษาไทยตอน reverse lookup) ----
  'ltr': 'l', 'litre': 'l', 'liter': 'l', 'liters': 'l', 'litres': 'l',
  'slices': 'slice', 'pieces': 'piece', 'tanks': 'tank',
}

// ===================================================================
// Canonical label (ภาษาไทย) ของแต่ละ code — ใช้แสดงผล/สร้างข้อความ note
// ===================================================================
const UNIT_LABELS: Record<string, string> = {
  kg: 'กิโลกรัม', g: 'กรัม', mg: 'มิลลิกรัม', hg: 'ขีด', lb: 'ปอนด์', oz: 'ออนซ์',
  inch: 'นิ้ว', cm: 'เซนติเมตร', mm: 'มิลลิเมตร', m: 'เมตร', km: 'กิโลเมตร',
  ft: 'ฟุต', yard: 'หลา',
  l: 'ลิตร', ml: 'มิลลิลิตร', gallon: 'แกลลอน', fl_oz: 'ฟลูอิดออนซ์',
  m2: 'ตารางเมตร', cm2: 'ตารางเซนติเมตร',
  pcs: 'ชิ้น', dozen: 'โหล', gross: 'โกรส', pair: 'คู่',
  box: 'กล่อง', pack: 'แพ็ค', set: 'ชุด', roll: 'ม้วน', sheet: 'แผ่น',
  bottle: 'ขวด', bag: 'ถุง', sachet: 'ซอง', case: 'ลัง', can: 'กระป๋อง',
  tube: 'หลอด', tablet: 'เม็ด', glass: 'แก้ว', tsp: 'ช้อนชา', tbsp: 'ช้อนโต๊ะ',
  plate: 'จาน', tray: 'ถาด', piece: 'ลูก', egg: 'ฟอง', item: 'รายการ',
  scoop: 'สกู๊ป', tank: 'ถัง', slice: 'สไลซ์',
  // generic fallback that some products carry instead of a real unit
  unit: 'หน่วย',
}

// English display names, keyed by the same canonical codes as UNIT_LABELS.
// Without these the English UI showed Thai unit names, because the label map
// was the only source of a human-readable name.
const UNIT_LABELS_EN: Record<string, string> = {
  kg: 'kilogram', g: 'gram', mg: 'milligram', hg: 'hectogram', lb: 'pound', oz: 'ounce',
  inch: 'inch', cm: 'centimetre', mm: 'millimetre', m: 'metre', km: 'kilometre',
  ft: 'foot', yard: 'yard',
  l: 'litre', ml: 'millilitre', gallon: 'gallon', fl_oz: 'fluid ounce',
  m2: 'square metre', cm2: 'square centimetre',
  pcs: 'piece', dozen: 'dozen', gross: 'gross', pair: 'pair',
  box: 'box', pack: 'pack', set: 'set', roll: 'roll', sheet: 'sheet',
  bottle: 'bottle', bag: 'bag', sachet: 'sachet', case: 'case', can: 'can',
  tube: 'tube', tablet: 'tablet', glass: 'glass', tsp: 'teaspoon', tbsp: 'tablespoon',
  plate: 'plate', tray: 'tray', piece: 'unit', egg: 'egg', item: 'item',
  scoop: 'scoop', tank: 'tank', slice: 'slice',
  unit: 'unit',
}

/** English display name for a unit; falls back to the code itself. */
export function getUnitDisplayNameEn(unit: string): string {
  const code = normalizeUnit(unit)
  return UNIT_LABELS_EN[code] || code || unit
}

/** Normalize unit name to canonical English code */
export function normalizeUnit(unit: string): string {
  if (unit === null || unit === undefined) return ''
  const u = String(unit).toLowerCase().trim()
  if (!u) return ''
  // Handle "label (code)" format e.g. "แพ็ค (pack)" → "pack"
  const match = u.match(/\(([^)]+)\)$/)
  if (match) {
    const inner = match[1].trim()
    return UNIT_NAME_MAP[inner] || inner
  }
  return UNIT_NAME_MAP[u] || u
}

/** Get display name (Thai if available, else original) */
export function getUnitDisplayName(unit: string): string {
  const normalized = normalizeUnit(unit)
  if (UNIT_LABELS[normalized]) return UNIT_LABELS[normalized]
  for (const [thai, eng] of Object.entries(UNIT_NAME_MAP)) {
    if (eng === normalized) return thai
  }
  return unit
}

/** alias ทั้งหมดที่ map มาที่ code นี้ */
function getUnitAliases(code: string): string[] {
  const out: string[] = []
  for (const [alias, eng] of Object.entries(UNIT_NAME_MAP)) {
    if (eng === code && alias !== code) out.push(alias)
  }
  return out
}

// ===================================================================
// Unit Category Mapping
// ===================================================================
const UNIT_CATEGORIES: Record<string, string[]> = {
  weight: ['kg', 'g', 'mg', 'hg', 'lb', 'oz'],
  length: ['inch', 'cm', 'mm', 'm', 'km', 'ft', 'yard'],
  volume: ['l', 'ml', 'gallon', 'fl_oz'],
  area: ['m2', 'cm2'],
  count: [
    'dozen', 'pcs', 'gross', 'pair', 'box', 'pack', 'set', 'roll', 'sheet',
    'bottle', 'bag', 'sachet', 'case', 'can', 'tube', 'tablet', 'glass',
    'plate', 'tray', 'piece', 'egg', 'item', 'scoop', 'tank', 'slice', 'unit',
  ],
}

const CATEGORY_ORDER = ['weight', 'volume', 'length', 'area', 'count', 'other']

export function getUnitCategory(unit: string): string | null {
  const u = normalizeUnit(unit)
  for (const [category, units] of Object.entries(UNIT_CATEGORIES)) {
    if (units.includes(u)) return category
  }
  return null
}

export function getCompatibleUnits(unit: string): string[] {
  const category = getUnitCategory(unit)
  if (!category) return [unit] // ไม่รู้จัก category ให้คืนแค่ตัวเอง
  return UNIT_CATEGORIES[category]
}

function generateId(): string {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// ===================================================================
// Graph-based Chain Conversion (Dijkstra: hops ก่อน, แล้วค่อย priority)
// priority: material = 0 (ชนะสุด), tenant = 1, standard = 2
// ===================================================================
export type ConversionRuleSource = 'material' | 'tenant' | 'standard'
export type ConversionSource = ConversionRuleSource | 'chain'

const SOURCE_PRIORITY: Record<ConversionRuleSource, number> = {
  material: 0,
  tenant: 1,
  standard: 2,
}

interface GraphEdge {
  to: string
  factor: number
  priority: number
  source: ConversionRuleSource
}

type ConversionGraph = Map<string, GraphEdge[]>

interface GraphCache {
  graph: ConversionGraph
  ts: number
}

const graphCache = new Map<string, GraphCache>()
const GRAPH_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * cache key จริงคือ `${tenantId}:${materialId ?? ''}` จึงต้องลบทุก key ที่ขึ้นต้นด้วย
 * `${tenantId}:` ไม่ใช่ลบแค่ key ชื่อ tenantId (บั๊กเดิม: invalidate ไม่เคยทำงาน)
 */
export function invalidateConversionGraphCache(tenantId: string) {
  const prefix = `${tenantId}:`
  for (const key of Array.from(graphCache.keys())) {
    if (key === tenantId || key.startsWith(prefix)) graphCache.delete(key)
  }
}

/**
 * @param excludeRuleId  build the graph as if this rule did not exist. Used to ask
 *   "what would the rate be without this row?", which is how a contradictory rule
 *   is spotted: the rest of the rules already imply a different number.
 *   Never cached — it is a one-off question, not the tenant's real graph.
 */
function buildConversionGraph(tenantId: string, materialId?: string, excludeRuleId?: string): ConversionGraph {
  const cacheKey = `${tenantId}:${materialId ?? ''}`
  if (!excludeRuleId) {
    const cached = graphCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < GRAPH_TTL) return cached.graph
  }

  const graph: ConversionGraph = new Map()

  /** ใส่ edge เดียว: ถ้ามีคู่ (from,to) อยู่แล้ว จะแทนที่ก็ต่อเมื่อ priority ดีกว่า (เลขน้อยกว่า) */
  const upsert = (from: string, to: string, factor: number, source: ConversionRuleSource) => {
    const priority = SOURCE_PRIORITY[source]
    if (!graph.has(from)) graph.set(from, [])
    const list = graph.get(from)!
    const idx = list.findIndex((e) => e.to === to)
    if (idx === -1) {
      list.push({ to, factor, priority, source })
      return
    }
    if (priority < list[idx].priority) list[idx] = { to, factor, priority, source }
  }

  const addEdge = (rawFrom: string, rawTo: string, rawFactor: number, source: ConversionRuleSource) => {
    const from = normalizeUnit(rawFrom)
    const to = normalizeUnit(rawTo)
    const factor = Number(rawFactor)
    if (!from || !to || from === to) return
    if (!Number.isFinite(factor) || factor <= 0) return
    upsert(from, to, factor, source)
    upsert(to, from, 1 / factor, source)
  }

  // 1) material-specific (priority สูงสุด) — ใส่ก่อนเพื่ออ่านง่าย
  //    (ลำดับการใส่ไม่สำคัญแล้ว เพราะ upsert แทนที่ตาม priority)
  if (materialId) {
    const matRows = db.prepare(`
      SELECT from_unit, to_unit, conversion_factor FROM unit_conversions
      WHERE material_id = ? AND tenant_id = ? AND id IS NOT ?
    `).all(materialId, tenantId, excludeRuleId ?? null) as Array<{ from_unit: string; to_unit: string; conversion_factor: number }>
    for (const row of matRows) {
      addEdge(row.from_unit, row.to_unit, row.conversion_factor, 'material')
    }
  }

  // 2) tenant-wide (material_id IS NULL)
  const globalRows = db.prepare(`
    SELECT from_unit, to_unit, conversion_factor FROM unit_conversions
    WHERE tenant_id = ? AND material_id IS NULL AND id IS NOT ?
  `).all(tenantId, excludeRuleId ?? null) as Array<{ from_unit: string; to_unit: string; conversion_factor: number }>
  for (const row of globalRows) {
    addEdge(row.from_unit, row.to_unit, row.conversion_factor, 'tenant')
  }

  // 3) มาตราสากล built-in (priority ต่ำสุด)
  for (const [key, factor] of Object.entries(STANDARD_CONVERSIONS)) {
    const [from, to] = key.split('->')
    addEdge(from, to, factor, 'standard')
  }

  // เรียง edge ตาม priority เพื่อให้การ traverse deterministic
  for (const list of graph.values()) {
    list.sort((a, b) => a.priority - b.priority || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
  }

  if (!excludeRuleId) graphCache.set(cacheKey, { graph, ts: Date.now() })
  return graph
}

const MAX_CHAIN_HOPS = 5

interface PathResult {
  factor: number
  path: string[]
  sources: ConversionRuleSource[]
}

/**
 * Dijkstra: cost เป็น lexicographic (จำนวน hop, ผลรวม priority)
 * → เส้นสั้นสุดชนะ, ถ้าเท่ากันเลือกเส้นที่มาจากกฎ priority ดีกว่า (material > tenant > standard)
 */
function searchConversionPath(normFrom: string, normTo: string, graph: ConversionGraph): PathResult | null {
  interface Node {
    unit: string
    factor: number
    path: string[]
    sources: ConversionRuleSource[]
    hops: number
    prio: number
  }
  const cmp = (a: { hops: number; prio: number }, b: { hops: number; prio: number }) =>
    a.hops - b.hops || a.prio - b.prio

  const best = new Map<string, { hops: number; prio: number }>()
  best.set(normFrom, { hops: 0, prio: 0 })
  const frontier: Node[] = [{ unit: normFrom, factor: 1, path: [normFrom], sources: [], hops: 0, prio: 0 }]

  while (frontier.length > 0) {
    let bi = 0
    for (let i = 1; i < frontier.length; i++) {
      if (cmp(frontier[i], frontier[bi]) < 0) bi = i
    }
    const cur = frontier.splice(bi, 1)[0]

    if (cur.unit === normTo) {
      return { factor: cur.factor, path: cur.path, sources: cur.sources }
    }
    if (cur.hops >= MAX_CHAIN_HOPS) continue

    const known = best.get(cur.unit)
    if (known && cmp(known, cur) < 0) continue // มีเส้นที่ดีกว่าเข้ามาแล้ว

    for (const edge of graph.get(cur.unit) ?? []) {
      const nextCost = { hops: cur.hops + 1, prio: cur.prio + edge.priority }
      const seen = best.get(edge.to)
      if (seen && cmp(seen, nextCost) <= 0) continue
      best.set(edge.to, nextCost)
      frontier.push({
        unit: edge.to,
        factor: cur.factor * edge.factor,
        path: [...cur.path, edge.to],
        sources: [...cur.sources, edge.source],
        hops: nextCost.hops,
        prio: nextCost.prio,
      })
    }
  }

  return null
}

/** BFS/Dijkstra หาเส้นทางแปลงหน่วยจาก `from` ไป `to` คืน factor รวม หรือ null */
export function findConversionChain(
  fromUnit: string,
  toUnit: string,
  tenantId: string,
  materialId?: string
): { factor: number; path: string[] } | null {
  const normFrom = normalizeUnit(fromUnit)
  const normTo = normalizeUnit(toUnit)
  if (!normFrom || !normTo) return null
  if (normFrom === normTo) return { factor: 1, path: [normFrom] }

  const graph = buildConversionGraph(tenantId, materialId)
  const found = searchConversionPath(normFrom, normTo, graph)
  if (!found) return null
  return { factor: found.factor, path: found.path }
}

// ===================================================================
// Row lookup helper (normalize ฝั่ง JS เพราะข้อมูลเก่าใน DB บางแถวยังไม่ normalize)
// ===================================================================
interface RawRule {
  from_unit: string
  to_unit: string
  conversion_factor: number
}

function lookupDirect(rows: RawRule[], normFrom: string, normTo: string): number | null {
  let reverse: number | null = null
  for (const row of rows) {
    const f = Number(row.conversion_factor)
    if (!Number.isFinite(f) || f === 0) continue
    const a = normalizeUnit(row.from_unit)
    const b = normalizeUnit(row.to_unit)
    if (a === normFrom && b === normTo) return f
    if (reverse === null && a === normTo && b === normFrom) reverse = 1 / f
  }
  return reverse
}

function materialRules(tenantId: string, materialId: string, excludeRuleId?: string): RawRule[] {
  return db.prepare(`
    SELECT from_unit, to_unit, conversion_factor FROM unit_conversions
    WHERE material_id = ? AND tenant_id = ? AND id IS NOT ?
  `).all(materialId, tenantId, excludeRuleId ?? null) as RawRule[]
}

function tenantRules(tenantId: string, excludeRuleId?: string): RawRule[] {
  return db.prepare(`
    SELECT from_unit, to_unit, conversion_factor FROM unit_conversions
    WHERE tenant_id = ? AND material_id IS NULL AND id IS NOT ?
  `).all(tenantId, excludeRuleId ?? null) as RawRule[]
}

function standardFactor(normFrom: string, normTo: string): number | null {
  const key = `${normFrom}->${normTo}`
  if (STANDARD_CONVERSIONS[key] !== undefined) return STANDARD_CONVERSIONS[key]
  const rev = `${normTo}->${normFrom}`
  if (STANDARD_CONVERSIONS[rev] !== undefined && STANDARD_CONVERSIONS[rev] !== 0) {
    return 1 / STANDARD_CONVERSIONS[rev]
  }
  return null
}

// ===================================================================
// resolveConversion — คืน factor พร้อมบอกว่ามาจากไหน
// ===================================================================
export interface ResolvedConversion {
  factor: number
  source: ConversionSource
  path: string[]
}

export function resolveConversion(
  fromUnit: string,
  toUnit: string,
  tenantId: string,
  materialId?: string,
  excludeRuleId?: string
): ResolvedConversion | null {
  const normFrom = normalizeUnit(fromUnit)
  const normTo = normalizeUnit(toUnit)
  if (!normFrom || !normTo) return null
  if (normFrom === normTo) return { factor: 1, source: 'standard', path: [normFrom] }

  // 1) material-specific ชนะเสมอ
  if (materialId) {
    const f = lookupDirect(materialRules(tenantId, materialId, excludeRuleId), normFrom, normTo)
    if (f !== null) return { factor: f, source: 'material', path: [normFrom, normTo] }
  }

  // 2) tenant-wide
  const tf = lookupDirect(tenantRules(tenantId, excludeRuleId), normFrom, normTo)
  if (tf !== null) return { factor: tf, source: 'tenant', path: [normFrom, normTo] }

  // 3) มาตราสากล built-in
  const sf = standardFactor(normFrom, normTo)
  if (sf !== null) return { factor: sf, source: 'standard', path: [normFrom, normTo] }

  // 4) chain ผ่านกราฟ
  const graph = buildConversionGraph(tenantId, materialId, excludeRuleId)
  const found = searchConversionPath(normFrom, normTo, graph)
  if (!found) return null
  const source: ConversionSource =
    found.sources.length === 1 ? found.sources[0] : 'chain'
  return { factor: found.factor, source, path: found.path }
}

// ===================================================================
// ตรวจกฎขัดกัน
// ===================================================================
/** Two rates for the same pair of units disagree by more than this fraction. */
const CONFLICT_TOLERANCE = 0.001

export interface ConversionConflict {
  fromUnit: string
  toUnit: string
  fromLabel: string
  toLabel: string
  newFactor: number
  existingFactor: number
  source: ConversionSource
  path: string[]
  pathLabels: string[]
  message: string
  messageEn: string
}

/**
 * Would saving `from → to = newFactor` contradict what the other rules already say?
 *
 * A hierarchy (material > tenant > standard) settles disagreements *between*
 * levels, but nothing settles two rules at the same level that disagree — e.g.
 * a product carrying both `bottle → ml = 720` and `bottle → l = 1` (= 1000 ml).
 * The resolver still answers deterministically, so the contradiction stays
 * invisible until someone compares two units and gets two different bottles.
 * Catching it at save time is the only place a human is still in the loop.
 *
 * @param excludeRuleId  the row being edited, so a rate is never judged against itself.
 * @returns the conflict, or null when the new rate agrees / nothing else implies one.
 */
export function detectConversionConflict(
  tenantId: string,
  fromUnit: string,
  toUnit: string,
  newFactor: number,
  materialId?: string,
  excludeRuleId?: string
): ConversionConflict | null {
  const normFrom = normalizeUnit(fromUnit)
  const normTo = normalizeUnit(toUnit)
  if (!normFrom || !normTo || normFrom === normTo) return null
  if (!Number.isFinite(newFactor) || newFactor <= 0) return null

  // Only rules of the SAME authority can contradict each other. A product-level
  // rate is *meant* to disagree with the company-wide one — MSG really is 3 g per
  // teaspoon where the generic rule says 5 g. Comparing across levels would flag
  // every legitimate override and block the feature this whole system exists for.
  const sameScope: ConversionRuleSource = materialId ? 'material' : 'tenant'
  const peers = materialId
    ? materialRules(tenantId, materialId, excludeRuleId)
    : tenantRules(tenantId, excludeRuleId)

  const graph: ConversionGraph = new Map()
  const link = (rawA: string, rawB: string, rawFactor: number, source: ConversionRuleSource) => {
    const a = normalizeUnit(rawA)
    const b = normalizeUnit(rawB)
    const f = Number(rawFactor)
    if (!a || !b || a === b) return
    if (!Number.isFinite(f) || f <= 0) return
    if (!graph.has(a)) graph.set(a, [])
    if (!graph.has(b)) graph.set(b, [])
    graph.get(a)!.push({ to: b, factor: f, priority: SOURCE_PRIORITY[source], source })
    graph.get(b)!.push({ to: a, factor: 1 / f, priority: SOURCE_PRIORITY[source], source })
  }

  for (const row of peers) link(row.from_unit, row.to_unit, Number(row.conversion_factor), sameScope)

  // Standard conversions stay in: 1 l = 1000 ml is physics, not policy, so nobody
  // gets to override it — and without them the chain bottle → ml → l never forms,
  // which is exactly the shape the fish-sauce contradiction had.
  for (const [key, factor] of Object.entries(STANDARD_CONVERSIONS)) {
    const [from, to] = key.split('->')
    link(from, to, factor, 'standard')
  }

  const peerPath = searchConversionPath(normFrom, normTo, graph)
  if (!peerPath || !Number.isFinite(peerPath.factor) || peerPath.factor <= 0) return null
  const existing = {
    factor: peerPath.factor,
    source: (peerPath.path.length === 2 ? sameScope : 'chain') as ConversionSource,
    path: peerPath.path,
  }

  const diff = Math.abs(existing.factor - newFactor) / existing.factor
  if (diff <= CONFLICT_TOLERANCE) return null

  const fromLabel = getUnitDisplayName(normFrom)
  const toLabel = getUnitDisplayName(normTo)
  const pathLabels = existing.path.map(getUnitDisplayName)
  const via = existing.path.length > 2 ? ` (ผ่าน ${pathLabels.join(' → ')})` : ''
  const viaEn = existing.path.length > 2
    ? ` (via ${existing.path.map(getUnitDisplayNameEn).join(' → ')})`
    : ''

  return {
    fromUnit: normFrom,
    toUnit: normTo,
    fromLabel,
    toLabel,
    newFactor,
    existingFactor: existing.factor,
    source: existing.source,
    path: existing.path,
    pathLabels,
    message:
      `ขัดกับกฎที่มีอยู่ — ตอนนี้ระบบคำนวณได้ว่า 1 ${fromLabel} = ` +
      `${formatFactor(existing.factor)} ${toLabel}${via} ` +
      `แต่กำลังจะบันทึกเป็น ${formatFactor(newFactor)} ${toLabel}`,
    messageEn:
      `Conflicts with an existing rule — the system currently derives 1 ${getUnitDisplayNameEn(normFrom)} = ` +
      `${formatFactor(existing.factor)} ${getUnitDisplayNameEn(normTo)}${viaEn}, ` +
      `but this would save ${formatFactor(newFactor)}`,
  }
}

// ===================================================================
// แปลงหน่วย: คืนค่า factor หรือ null ถ้าหาไม่เจอ
// (คง signature เดิม — direct only, ไม่ทำ chain)
// ===================================================================
export function getConversionFactor(
  fromUnit: string,
  toUnit: string,
  tenantId: string,
  materialId?: string
): number | null {
  const normFrom = normalizeUnit(fromUnit)
  const normTo = normalizeUnit(toUnit)
  if (!normFrom || !normTo) return null
  if (normFrom === normTo) return 1

  // 1. material-specific ก่อน
  if (materialId) {
    const row = db.prepare(`
      SELECT conversion_factor FROM unit_conversions
      WHERE material_id = ? AND from_unit = ? AND to_unit = ?
      LIMIT 1
    `).get(materialId, normFrom, normTo) as any
    if (row) return Number(row.conversion_factor)
  }

  // 2. tenant-level global (material_id IS NULL)
  const tenantRow = db.prepare(`
    SELECT conversion_factor FROM unit_conversions
    WHERE tenant_id = ? AND material_id IS NULL AND from_unit = ? AND to_unit = ?
    LIMIT 1
  `).get(tenantId, normFrom, normTo) as any
  if (tenantRow) return Number(tenantRow.conversion_factor)

  // 3. มาตราสากล built-in
  const key = `${normFrom}->${normTo}`
  if (STANDARD_CONVERSIONS[key] !== undefined) return STANDARD_CONVERSIONS[key]

  return null
}

// แปลงจำนวน quantity จากหน่วยหนึ่งไปอีกหน่วย
export function convertQuantity(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  tenantId: string,
  materialId?: string
): { converted: number; factor: number } | null {
  const factor = getConversionFactor(fromUnit, toUnit, tenantId, materialId)
  if (factor === null) return null
  return { converted: quantity * factor, factor }
}

// แปลงแบบสองทิศทาง — ตอนนี้เดินผ่าน resolveConversion (signature เดิมไม่เปลี่ยน)
export function convertQuantityBidirectional(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  tenantId: string,
  materialId?: string
): { converted: number; factor: number } | null {
  const resolved = resolveConversion(fromUnit, toUnit, tenantId, materialId)
  if (!resolved) return null
  if (resolved.path.length > 2) {
    console.info(`[unit-chain] ${resolved.path.join('→')} factor=${resolved.factor} source=${resolved.source}`)
  }
  return { converted: quantity * resolved.factor, factor: resolved.factor }
}

// ===================================================================
// Auto-Unpack: เปิดแพ็คอัตโนมัติเมื่อ quantity ไม่พอ
// ===================================================================
export interface AutoUnpackResult {
  quantity: number      // loose base units หลังแกะ
  sealed_qty: number    // sealed packs ที่เหลือ
  unpackedPacks: number // แพ็คที่ถูกแกะในรอบนี้
  packFactor: number    // base units ต่อ 1 แพ็ค
}

export function autoUnpackIfNeeded(
  stockItem: {
    id: string
    quantity: number
    sealed_qty: number
    display_unit?: string | null
    base_unit?: string | null
    unit: string
    material_id?: string | null
  },
  neededInBase: number,
  tenantId: string
): AutoUnpackResult | null {
  // พอแล้ว ไม่ต้องแกะ
  if (stockItem.quantity >= neededInBase) {
    return { quantity: stockItem.quantity, sealed_qty: stockItem.sealed_qty ?? 0, unpackedPacks: 0, packFactor: 0 }
  }

  const displayUnit = stockItem.display_unit
  if (!displayUnit || (stockItem.sealed_qty ?? 0) <= 0) return null

  const baseUnit = stockItem.base_unit || stockItem.unit
  if (normalizeUnit(displayUnit) === normalizeUnit(baseUnit)) return null

  const chain = findConversionChain(displayUnit, baseUnit, tenantId, stockItem.id ?? stockItem.material_id ?? undefined)
  if (!chain || chain.factor <= 0) return null

  // เดิมใช้ Math.round() โดยสมมติว่า factor ต้องเป็นจำนวนเต็มเสมอ (เช่น 3 ขวด/แพ็ค)
  // แต่หน่วยต่อเนื่อง เช่น ผ้า/สาย/ท่อ/ของเหลว มี factor เป็นทศนิยมได้จริง
  // (เช่น 1 ม้วน = 45.7 เมตร) — ปัดด้วย Math.round ทำให้ 45.7 กลายเป็น 46 แล้วคูณ
  // จำนวนแพ็คที่แกะ เสกจำนวนเนื้อผ้าเพิ่มขึ้นมาโดยไม่มีอยู่จริง
  // เปลี่ยนมาใช้ roundQty() (ปัด 6 ตำแหน่งทศนิยม) ให้ตรงกับ getPackFactor() ใน
  // stock.routes.ts ที่แกะแพ็คด้วยมือใช้อยู่แล้ว ไม่งั้นแกะมือกับแกะอัตโนมัติจะได้
  // ตัวเลขไม่ตรงกันสำหรับสินค้าตัวเดียวกัน
  const packFactor = roundQty(chain.factor)

  let qty = stockItem.quantity
  let sealed = stockItem.sealed_qty ?? 0
  let unpackedPacks = 0

  while (qty < neededInBase && sealed > 0) {
    sealed -= 1
    // roundQty กันเศษ floating-point สะสม (เช่น 45.7 บวกกันหลายรอบ) ไม่ให้ลอยเพี้ยน
    qty = roundQty(qty + packFactor)
    unpackedPacks += 1
  }

  if (qty < neededInBase) return null // ยังไม่พอแม้แกะหมดแล้ว

  return { quantity: qty, sealed_qty: sealed, unpackedPacks, packFactor }
}

// ===================================================================
// Unit Catalog — สำหรับ dropdown เลือกหน่วย + badge หน่วยพิเศษ
// ===================================================================
export interface UnitCatalogEntry {
  code: string
  /** Thai display name. */
  label: string
  /** English display name — the client picks one by the active language. */
  labelEn: string
  category: string
  scope: 'base' | 'tenant' | 'material'
  aliases: string[]
}

export interface UnitSpecialEntry {
  code: string
  label: string
  labelEn: string
  category: string
  scope: 'tenant' | 'material'
  factor: number
  baseUnit: string
  baseLabel: string
  baseLabelEn: string
  note: string
  noteEn: string
}

export interface UnitCatalog {
  units: UnitCatalogEntry[]
  specials: UnitSpecialEntry[]
}

function formatFactor(n: number): string {
  return String(Number(n.toFixed(6)))
}

function isNonStandardFactor(normFrom: string, normTo: string, factor: number): boolean {
  const std = standardFactor(normFrom, normTo)
  if (std === null) return true
  return Math.abs(std - factor) > Math.max(1e-9, Math.abs(std) * 1e-6)
}

export function getUnitCatalog(tenantId: string, materialId?: string): UnitCatalog {
  // ---------- units ----------
  const scopeOf = new Map<string, 'base' | 'tenant' | 'material'>()

  // built-in codes: จาก category + label map + มาตราสากล
  const addBase = (raw: string) => {
    const code = normalizeUnit(raw)
    if (code && !scopeOf.has(code)) scopeOf.set(code, 'base')
  }
  for (const list of Object.values(UNIT_CATEGORIES)) list.forEach(addBase)
  Object.keys(UNIT_LABELS).forEach(addBase)
  for (const key of Object.keys(STANDARD_CONVERSIONS)) key.split('->').forEach(addBase)

  const tRules = tenantRules(tenantId)
  const mRules = materialId ? materialRules(tenantId, materialId) : []

  for (const row of tRules) {
    for (const raw of [row.from_unit, row.to_unit]) {
      const code = normalizeUnit(raw)
      if (code && !scopeOf.has(code)) scopeOf.set(code, 'tenant')
    }
  }
  for (const row of mRules) {
    for (const raw of [row.from_unit, row.to_unit]) {
      const code = normalizeUnit(raw)
      if (code && !scopeOf.has(code)) scopeOf.set(code, 'material')
    }
  }

  const units: UnitCatalogEntry[] = Array.from(scopeOf.entries()).map(([code, scope]) => ({
    code,
    label: getUnitDisplayName(code),
    labelEn: getUnitDisplayNameEn(code),
    category: getUnitCategory(code) ?? 'other',
    scope,
    aliases: getUnitAliases(code),
  }))

  units.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category)
    const cb = CATEGORY_ORDER.indexOf(b.category)
    const oa = ca === -1 ? CATEGORY_ORDER.length : ca
    const ob = cb === -1 ? CATEGORY_ORDER.length : cb
    if (oa !== ob) return oa - ob
    const byLabel = a.label.localeCompare(b.label, 'th')
    if (byLabel !== 0) return byLabel
    return a.code.localeCompare(b.code)
  })

  // ---------- specials ----------
  const specialMap = new Map<string, UnitSpecialEntry>()

  const collect = (rows: RawRule[], scope: 'tenant' | 'material') => {
    for (const row of rows) {
      const from = normalizeUnit(row.from_unit)
      const to = normalizeUnit(row.to_unit)
      const factor = Number(row.conversion_factor)
      if (!from || !to || from === to) continue
      if (!Number.isFinite(factor) || factor <= 0) continue
      if (!isNonStandardFactor(from, to, factor)) continue
      const label = getUnitDisplayName(from)
      const baseLabel = getUnitDisplayName(to)
      const labelEn = getUnitDisplayNameEn(from)
      const baseLabelEn = getUnitDisplayNameEn(to)
      specialMap.set(`${from}->${to}`, {
        code: from,
        label,
        labelEn,
        category: getUnitCategory(from) ?? 'other',
        scope,
        factor,
        baseUnit: to,
        baseLabel,
        baseLabelEn,
        note: `1 ${label} = ${formatFactor(factor)} ${baseLabel}`,
        noteEn: `1 ${labelEn} = ${formatFactor(factor)} ${baseLabelEn}`,
      })
    }
  }

  collect(tRules, 'tenant')     // tenant ก่อน
  collect(mRules, 'material')   // material ทับ tenant ถ้าคู่หน่วยเดียวกัน

  const specials = Array.from(specialMap.values()).sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category)
    const cb = CATEGORY_ORDER.indexOf(b.category)
    const oa = ca === -1 ? CATEGORY_ORDER.length : ca
    const ob = cb === -1 ? CATEGORY_ORDER.length : cb
    if (oa !== ob) return oa - ob
    if (a.code !== b.code) return a.code.localeCompare(b.code)
    return a.baseUnit.localeCompare(b.baseUnit)
  })

  return { units, specials }
}

// ===================================================================
// CRUD — Custom Conversions
// ===================================================================
export function listConversions(tenantId: string, materialId?: string): UnitConversion[] {
  if (materialId) {
    return db.prepare(`
      SELECT * FROM unit_conversions
      WHERE tenant_id = ? AND material_id = ?
      ORDER BY from_unit
    `).all(tenantId, materialId) as UnitConversion[]
  }
  return db.prepare(`
    SELECT * FROM unit_conversions
    WHERE tenant_id = ? AND material_id IS NULL
    ORDER BY from_unit
  `).all(tenantId) as UnitConversion[]
}

// คืนค่า conversion ทั้งหมด รวม per-material พร้อมชื่อสินค้า
export function listAllConversions(tenantId: string): Array<UnitConversion & { material_name?: string; material_sku?: string }> {
  return db.prepare(`
    SELECT uc.*, s.name as material_name, s.sku as material_sku
    FROM unit_conversions uc
    LEFT JOIN stock_items s ON uc.material_id = s.id
    WHERE uc.tenant_id = ?
    ORDER BY uc.material_id NULLS FIRST, uc.from_unit
  `).all(tenantId) as any[]
}

export function createConversion(
  tenantId: string,
  data: { material_id?: string; from_unit: string; to_unit: string; conversion_factor: number; notes?: string }
): UnitConversion {
  const id = generateId()
  const now = new Date().toISOString()
  const normFrom = normalizeUnit(data.from_unit)
  const normTo = normalizeUnit(data.to_unit)
  db.prepare(`
    INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, data.material_id ?? null, normFrom, normTo, data.conversion_factor, data.notes ?? null, now, now)

  invalidateConversionGraphCache(tenantId)
  return db.prepare(`SELECT * FROM unit_conversions WHERE id = ?`).get(id) as UnitConversion
}

export function updateConversion(
  id: string,
  tenantId: string,
  data: { conversion_factor?: number; notes?: string }
): UnitConversion | null {
  const existing = db.prepare(`SELECT * FROM unit_conversions WHERE id = ? AND tenant_id = ? AND is_global = 0`).get(id, tenantId) as any
  if (!existing) return null

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE unit_conversions
    SET conversion_factor = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.conversion_factor ?? existing.conversion_factor,
    data.notes !== undefined ? data.notes : existing.notes,
    now,
    id
  )
  invalidateConversionGraphCache(tenantId)
  return db.prepare(`SELECT * FROM unit_conversions WHERE id = ?`).get(id) as UnitConversion
}

export function deleteConversion(id: string, tenantId: string): boolean {
  const result = db.prepare(`
    DELETE FROM unit_conversions WHERE id = ? AND tenant_id = ? AND is_global = 0
  `).run(id, tenantId)
  if (result.changes > 0) invalidateConversionGraphCache(tenantId)
  return result.changes > 0
}

// ส่ง list ของมาตราสากลที่ระบบรองรับ (สำหรับแสดงใน UI)
export function getStandardConversions(): Array<{ from_unit: string; to_unit: string; factor: number }> {
  return Object.entries(STANDARD_CONVERSIONS).map(([key, factor]) => {
    const [from_unit, to_unit] = key.split('->')
    return { from_unit, to_unit, factor }
  })
}
