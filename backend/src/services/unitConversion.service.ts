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
  'กล่อง': 'box', 'แพ็ค': 'pack', 'ชุด': 'set', 'ม้วน': 'roll',
  'แผ่น': 'sheet', 'ขวด': 'bottle',
}

/** Normalize unit name to English code */
export function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase().trim()
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

// แปลงแบบสองทิศทาง: ถ้าหา direct ไม่เจอ ให้ลอง reverse
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

  return null
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
  db.prepare(`
    INSERT INTO unit_conversions (id, tenant_id, material_id, from_unit, to_unit, conversion_factor, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, data.material_id ?? null, data.from_unit, data.to_unit, data.conversion_factor, data.notes ?? null, now, now)

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
  return db.prepare(`SELECT * FROM unit_conversions WHERE id = ?`).get(id) as UnitConversion
}

export function deleteConversion(id: string, tenantId: string): boolean {
  const result = db.prepare(`
    DELETE FROM unit_conversions WHERE id = ? AND tenant_id = ? AND is_global = 0
  `).run(id, tenantId)
  return result.changes > 0
}

// ส่ง list ของมาตราสากลที่ระบบรองรับ (สำหรับแสดงใน UI)
export function getStandardConversions(): Array<{ from_unit: string; to_unit: string; factor: number }> {
  return Object.entries(STANDARD_CONVERSIONS).map(([key, factor]) => {
    const [from_unit, to_unit] = key.split('->')
    return { from_unit, to_unit, factor }
  })
}
