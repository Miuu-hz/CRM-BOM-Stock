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
}

export function normalizeUnit(unit: string): string {
  if (!unit) return unit
  const u = unit.toLowerCase().trim()
  const match = u.match(/\(([^)]+)\)$/)
  if (match) return match[1].trim()
  return UNIT_NAME_MAP[u] || u
}
