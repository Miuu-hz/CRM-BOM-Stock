import db from '../db/sqlite'

/**
 * โหมด VAT ตั้งต้นของกิจการ — เอกสารที่ไม่ได้ระบุมาเองจะใช้ค่านี้
 * แยกจาก pos_vat_inclusive โดยตั้งใจ: ร้านอาจติดราคารวม VAT ที่หน้าร้าน
 * แต่เสนอราคาขายส่งแบบแยก VAT
 */
export function tenantVatInclusive(tenantId: string): boolean {
  const row = db.prepare('SELECT vat_inclusive FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  return row?.vat_inclusive === 1
}

/** ค่าที่เอกสารจะใช้จริง — ระบุมาเองชนะค่าตั้งต้นของกิจการ */
export function resolveVatInclusive(tenantId: string, requested?: boolean | number | null): 0 | 1 {
  if (requested !== undefined && requested !== null) return requested ? 1 : 0
  return tenantVatInclusive(tenantId) ? 1 : 0
}
