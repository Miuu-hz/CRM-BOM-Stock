import db from '../db/sqlite'
import { randomUUID } from 'crypto'

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

  // ปริมาตร
  'l->ml': 1000,
  'ml->l': 0.001,
  'ltr->ml': 1000,
  'ml->ltr': 0.001,
  'ltr->l': 1,
  'l->ltr': 1,
  'gallon->l': 3.78541,
  'l->gallon': 0.264172,
  'fl_oz->ml': 29.5735,
  'ml->fl_oz': 0.033814,

  // พื้นที่
  'm2->cm2': 10000,
  'cm2->m2': 0.0001,
  'sqm->sqcm': 10000,
  'sqcm->sqm': 0.0001,

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
// Unit Name Mapping (Thai ↔ English)
// ===================================================================
const UNIT_NAME_MAP: Record<string, string> = {
  // น้ำหนัก
  'กิโลกรัม': 'kg', 'กรัม': 'g', 'มิลลิกรัม': 'mg',
  'ปอนด์': 'lb', 'ออนซ์': 'oz',
  // ความยาว
  'นิ้ว': 'inch', 'เซนติเมตร': 'cm', 'มิลลิเมตร': 'mm',
  'เมตร': 'm', 'กิโลเมตร': 'km', 'ฟุต': 'ft', 'หลา': 'yard',
  // ปริมาตร
  'ลิตร': 'l', 'มิลลิลิตร': 'ml', 'แกลลอน': 'gallon',
  // พื้นที่
  'ตารางเมตร': 'm2', 'ตารางเซนติเมตร': 'cm2',
  // หน่วยนับ
  'ชิ้น': 'pcs', 'โหล': 'dozen', 'โกรส': 'gross', 'คู่': 'pair',
  'กล่อง': 'box', 'แพ็ค': 'pack', 'แพ๊ค': 'pack', 'แพค': 'pack',
  'ชุด': 'set', 'ม้วน': 'roll',
  'แผ่น': 'sheet', 'ขวด': 'bottle', 'ถุง': 'bag', 'ซอง': 'sachet',
  'ลัง': 'case', 'กระป๋อง': 'can', 'หลอด': 'tube', 'เม็ด': 'tablet',
  'แก้ว': 'glass', 'ช้อนชา': 'tsp', 'ช้อนโต๊ะ': 'tbsp',
  'มล.': 'ml', 'จาน': 'plate', 'ถาด': 'tray', 'ลูก': 'piece',
  'ฟอง': 'egg', 'รายการ': 'item', 'สกู๊ป': 'scoop',
  // spelling variants ที่พบบ่อย
  'กุรอส': 'gross',
}

/** Normalize unit name to English code */
export function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase().trim()
  // Handle "label (code)" format e.g. "แพ็ค (pack)" → "pack"
  const match = u.match(/\(([^)]+)\)$/)
  if (match) return match[1].trim()
  return UNIT_NAME_MAP[u] || u
}

/** Get display name (Thai if available, else original) */
export function getUnitDisplayName(unit: string): string {
  const normalized = normalizeUnit(unit)
  for (const [thai, eng] of Object.entries(UNIT_NAME_MAP)) {
    if (eng === normalized) return thai
  }
  return unit
}

// ===================================================================
// Unit Category Mapping
// ===================================================================
const UNIT_CATEGORIES: Record<string, string[]> = {
  weight: ['kg', 'g', 'mg', 'lb', 'oz'],
  length: ['inch', 'cm', 'mm', 'm', 'km', 'ft', 'yard'],
  volume: ['l', 'ml', 'ltr', 'gallon', 'fl_oz'],
  area: ['m2', 'cm2', 'sqm', 'sqcm'],
  count: ['dozen', 'pcs', 'gross', 'pair', 'box', 'pack', 'set', 'roll', 'sheet', 'bottle'],
}

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
// Graph-based Chain Conversion (BFS)
// ===================================================================
type ConversionGraph = Map<string, Array<{ to: string; factor: number }>>

interface GraphCache {
  graph: ConversionGraph
  ts: number
}

const graphCache = new Map<string, GraphCache>()
const GRAPH_TTL = 5 * 60 * 1000 // 5 minutes

export function invalidateConversionGraphCache(tenantId: string) {
  graphCache.delete(tenantId)
}

function buildConversionGraph(tenantId: string, materialId?: string): ConversionGraph {
  const cacheKey = `${tenantId}:${materialId ?? ''}`
  const cached = graphCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < GRAPH_TTL) return cached.graph

  const graph: ConversionGraph = new Map()

  const addEdge = (from: string, to: string, factor: number) => {
    if (!graph.has(from)) graph.set(from, [])
    graph.get(from)!.push({ to, factor })
    // reverse edge
    if (!graph.has(to)) graph.set(to, [])
    graph.get(to)!.push({ to: from, factor: 1 / factor })
  }

  // STANDARD_CONVERSIONS (bidirectional already defined, deduplicate via seen)
  const seen = new Set<string>()
  for (const [key, factor] of Object.entries(STANDARD_CONVERSIONS)) {
    const [from, to] = key.split('->')
    const fwd = `${from}->${to}`
    const rev = `${to}->${from}`
    if (!seen.has(fwd) && !seen.has(rev)) {
      seen.add(fwd)
      seen.add(rev)
      addEdge(from, to, factor)
    }
  }

  // tenant global conversions
  const globalRows = db.prepare(`
    SELECT from_unit, to_unit, conversion_factor FROM unit_conversions
    WHERE tenant_id = ? AND material_id IS NULL
  `).all(tenantId) as Array<{ from_unit: string; to_unit: string; conversion_factor: number }>

  for (const row of globalRows) {
    addEdge(row.from_unit, row.to_unit, row.conversion_factor)
  }

  // material-specific conversions (override or supplement)
  if (materialId) {
    const matRows = db.prepare(`
      SELECT from_unit, to_unit, conversion_factor FROM unit_conversions
      WHERE material_id = ?
    `).all(materialId) as Array<{ from_unit: string; to_unit: string; conversion_factor: number }>

    for (const row of matRows) {
      addEdge(row.from_unit, row.to_unit, row.conversion_factor)
    }
  }

  graphCache.set(cacheKey, { graph, ts: Date.now() })
  return graph
}

/** BFS to find a conversion chain from `from` to `to`. Returns combined factor or null. */
export function findConversionChain(
  fromUnit: string,
  toUnit: string,
  tenantId: string,
  materialId?: string
): { factor: number; path: string[] } | null {
  const normFrom = normalizeUnit(fromUnit)
  const normTo = normalizeUnit(toUnit)
  if (normFrom === normTo) return { factor: 1, path: [normFrom] }

  const graph = buildConversionGraph(tenantId, materialId)

  // BFS
  const queue: Array<{ unit: string; factor: number; path: string[] }> = [
    { unit: normFrom, factor: 1, path: [normFrom] },
  ]
  const visited = new Set<string>([normFrom])

  while (queue.length > 0) {
    const { unit, factor, path } = queue.shift()!
    if (path.length > 5) continue // max depth

    for (const edge of graph.get(unit) ?? []) {
      if (visited.has(edge.to)) continue
      const newFactor = factor * edge.factor
      const newPath = [...path, edge.to]
      if (edge.to === normTo) return { factor: newFactor, path: newPath }
      visited.add(edge.to)
      queue.push({ unit: edge.to, factor: newFactor, path: newPath })
    }
  }

  return null
}

// ===================================================================
// แปลงหน่วย: คืนค่า factor หรือ null ถ้าหาไม่เจอ
// ===================================================================
export function getConversionFactor(
  fromUnit: string,
  toUnit: string,
  tenantId: string,
  materialId?: string
): number | null {
  const normFrom = normalizeUnit(fromUnit)
  const normTo = normalizeUnit(toUnit)
  if (normFrom === normTo) return 1

  const key = `${normFrom}->${normTo}`

  // 1. ตรวจสอบ material-specific ก่อน (ใช้ normalized unit)
  if (materialId) {
    const row = db.prepare(`
      SELECT conversion_factor FROM unit_conversions
      WHERE material_id = ? AND from_unit = ? AND to_unit = ?
      LIMIT 1
    `).get(materialId, normFrom, normTo) as any
    if (row) return Number(row.conversion_factor)
  }

  // 2. ตรวจสอบ tenant-level global (material_id IS NULL)
  const tenantRow = db.prepare(`
    SELECT conversion_factor FROM unit_conversions
    WHERE tenant_id = ? AND material_id IS NULL AND from_unit = ? AND to_unit = ?
    LIMIT 1
  `).get(tenantId, normFrom, normTo) as any
  if (tenantRow) return Number(tenantRow.conversion_factor)

  // 3. มาตราสากล built-in
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

// แปลงแบบสองทิศทาง: direct → reverse → BFS chain
export function convertQuantityBidirectional(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  tenantId: string,
  materialId?: string
): { converted: number; factor: number } | null {
  // 1. ลอง direct
  const direct = convertQuantity(quantity, fromUnit, toUnit, tenantId, materialId)
  if (direct) return direct

  // 2. ลอง reverse (swap from/to แล้วหาร)
  const reverse = convertQuantity(1, toUnit, fromUnit, tenantId, materialId)
  if (reverse && reverse.factor !== 0) {
    const factor = 1 / reverse.factor
    return { converted: quantity * factor, factor }
  }

  // 3. BFS chain (เช่น pack→bottle→liter)
  const chain = findConversionChain(fromUnit, toUnit, tenantId, materialId)
  if (chain) {
    console.info(`[unit-chain] ${chain.path.join('→')} factor=${chain.factor}`)
    return { converted: quantity * chain.factor, factor: chain.factor }
  }

  return null
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

  const packFactor = Math.round(chain.factor) // ใช้ round เพราะ factor ควรเป็น integer (3 ขวด/แพ็ค)

  let qty = stockItem.quantity
  let sealed = stockItem.sealed_qty ?? 0
  let unpackedPacks = 0

  while (qty < neededInBase && sealed > 0) {
    sealed -= 1
    qty += packFactor
    unpackedPacks += 1
  }

  if (qty < neededInBase) return null // ยังไม่พอแม้แกะหมดแล้ว

  return { quantity: qty, sealed_qty: sealed, unpackedPacks, packFactor }
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
