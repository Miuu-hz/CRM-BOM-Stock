import db from '../db/sqlite'
import { VAT_RATE, isValidVatRate } from './vat'

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

/** อัตรา VAT ของกิจการ — admin (หรือผู้ที่ได้สิทธิ์ settings:write) ตั้งที่ Settings > บิล/VAT · ไม่ได้ตั้ง = 7% */
export function tenantVatRate(tenantId: string): number {
  const row = db.prepare('SELECT pos_vat_rate FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  const r = Number(row?.pos_vat_rate)
  return Number.isFinite(r) && r > 0 ? r : VAT_RATE
}

/** null = อัตรานี้ใช้ได้ · string = ข้อความ 400 (รับแค่ 0 หรืออัตราที่กิจการตั้งไว้) */
export function vatRateError(tenantId: string, rate: unknown): string | null {
  const allowed = tenantVatRate(tenantId)
  return isValidVatRate(rate, allowed) ? null : `อัตรา VAT ไม่ถูกต้อง — ใช้ได้เฉพาะ 0% หรือ ${allowed}% (ตั้งค่าที่ Settings > บิล/VAT)`
}
