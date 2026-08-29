export const UNIT_NAME_MAP: Record<string, string> = {
  'กิโลกรัม': 'kg', 'กรัม': 'g', 'มิลลิกรัม': 'mg',
  'ขีด': 'hg',
  'ก.ก.': 'kg', 'กก.': 'kg', 'กก': 'kg', 'กิโล': 'kg',
  'กรัม.': 'g',
  'ซีซี': 'ml', 'cc': 'ml',
  'ปอนด์': 'lb', 'ออนซ์': 'oz',
  'นิ้ว': 'inch', 'เซนติเมตร': 'cm', 'มิลลิเมตร': 'mm',
  'เมตร': 'm', 'กิโลเมตร': 'km', 'ฟุต': 'ft', 'หลา': 'yard',
  'ลิตร': 'l', 'มิลลิลิตร': 'ml', 'แกลลอน': 'gallon',
  'ตารางเมตร': 'm2', 'ตารางเซนติเมตร': 'cm2',
  'ชิ้น': 'pcs', 'โหล': 'dozen', 'โกรส': 'gross', 'คู่': 'pair',
  'กล่อง': 'box', 'แพ็ค': 'pack', 'แพ๊ค': 'pack', 'แพค': 'pack',
  'ชุด': 'set', 'ม้วน': 'roll',
  'แผ่น': 'sheet', 'ขวด': 'bottle', 'ถุง': 'bag', 'ซอง': 'sachet',
  'ลัง': 'case', 'กระป๋อง': 'can', 'หลอด': 'tube', 'เม็ด': 'tablet',
  'แก้ว': 'glass', 'ช้อนชา': 'tsp', 'ช้อนโต๊ะ': 'tbsp',
  'มล.': 'ml', 'จาน': 'plate', 'ถาด': 'tray', 'ลูก': 'piece',
  'ฟอง': 'egg', 'รายการ': 'item', 'สกู๊ป': 'scoop',
  'กุรอส': 'gross',
  // เพิ่มใหม่ — พบใน stock_items จริง
  'ถัง': 'tank', 'สไลซ์': 'slice', 'หน่วย': 'unit',
}

/**
 * Canonical code map — รวมรหัสที่สะกดต่างกันแต่หมายถึงหน่วยเดียวกัน
 * ให้เหลือรหัสเดียว เพื่อไม่ให้ dropdown มีรายการซ้ำ
 * (frontend มี map ของตัวเอง คนละไฟล์กับ backend — ต้อง sync กันด้วยมือ)
 */
export const UNIT_CODE_CANONICAL: Record<string, string> = {
  ltr: 'l', litre: 'l', liter: 'l', lt: 'l',
  slices: 'slice',
  pieces: 'pcs', pc: 'pcs', piece_s: 'pcs',
  grams: 'g', gram: 'g',
  kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  mls: 'ml', millilitre: 'ml', milliliter: 'ml',
  packs: 'pack', pkt: 'pack',
  boxes: 'box',
  bottles: 'bottle',
  bags: 'bag',
  sachets: 'sachet',
  sets: 'set',
  sheets: 'sheet',
  rolls: 'roll',
  eggs: 'egg',
  tanks: 'tank',
}

/** ทำให้รหัสหน่วยเป็นรูปแบบมาตรฐานเดียว เช่น ltr -> l, slices -> slice */
export function canonicalUnitCode(code: string): string {
  if (!code) return code
  const c = code.toLowerCase().trim()
  return UNIT_CODE_CANONICAL[c] || c
}

export function normalizeUnit(unit: string): string {
  if (!unit) return unit
  const u = unit.toLowerCase().trim()
  // รูปแบบ "แพ็ค (pack)" -> เอาเฉพาะรหัสในวงเล็บ
  const match = u.match(/\(([^)]+)\)$/)
  if (match) return canonicalUnitCode(match[1].trim())
  // ชื่อไทย -> รหัส (ใช้ค่าดั้งเดิม เพราะ toLowerCase ไม่กระทบภาษาไทย
  // แต่ key บางตัวเป็นอังกฤษ เช่น 'cc' จึงลองทั้งสองแบบ)
  const mapped = UNIT_NAME_MAP[unit.trim()] || UNIT_NAME_MAP[u]
  if (mapped) return canonicalUnitCode(mapped)
  return canonicalUnitCode(u)
}
