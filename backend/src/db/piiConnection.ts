import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

// ฐานข้อมูล PII แยกไฟล์จากฐานหลัก dev.db (ห้าม ATTACH และห้าม import db/sqlite)
// เก็บเฉพาะชื่อผู้รับ เบอร์โทร ที่อยู่เต็ม รหัสไปรษณีย์ ของออเดอร์ออนไลน์
// สำรองในเครื่องเท่านั้น ห้ามอัปโหลด Google Drive
export const piiDbPath = process.env.SQLITE_PII_DB_PATH ?? path.join(__dirname, '../../pii.db')
export const piiDb: any = new Database(piiDbPath)

piiDb.pragma('busy_timeout = 5000')

// สร้างตารางเองด้วย PRAGMA user_version (v1)
const currentVersion = Number(piiDb.pragma('user_version', { simple: true })) || 0
if (currentVersion < 1) {
  piiDb.exec(`
    CREATE TABLE IF NOT EXISTS online_order_pii (
      tenant_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      shop_key TEXT NOT NULL,
      order_no TEXT NOT NULL,
      buyer_name TEXT,
      buyer_phone TEXT,
      full_address TEXT,
      postal_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, platform, shop_key, order_no)
    );
    PRAGMA user_version = 1;
  `)
}

try {
  fs.chmodSync(piiDbPath, 0o600)
} catch {
  // ข้ามถ้า OS/filesystem ไม่รองรับ POSIX chmod (เช่น Windows หรือ :memory:)
}

export interface OrderPiiRow {
  tenantId: string
  platform: string
  shopKey: string
  orderNo: string
  buyerName?: string | null
  buyerPhone?: string | null
  fullAddress?: string | null
  postalCode?: string | null
}

const cleanStr = (v?: string | null): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t.length > 0 ? t : null
}

/**
 * บันทึก/อัปเดต PII ของออเดอร์ออนไลน์แบบ idempotent (เขียนก่อนฐานหลัก)
 */
export function upsertOrderPii(rows: OrderPiiRow[]): void {
  if (!rows || rows.length === 0) return
  const now = new Date().toISOString()
  const stmt = piiDb.prepare(`
    INSERT INTO online_order_pii
      (tenant_id, platform, shop_key, order_no, buyer_name, buyer_phone, full_address, postal_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, platform, shop_key, order_no) DO UPDATE SET
      buyer_name = COALESCE(excluded.buyer_name, online_order_pii.buyer_name),
      buyer_phone = COALESCE(excluded.buyer_phone, online_order_pii.buyer_phone),
      full_address = COALESCE(excluded.full_address, online_order_pii.full_address),
      postal_code = COALESCE(excluded.postal_code, online_order_pii.postal_code),
      updated_at = excluded.updated_at
  `)
  const tx = piiDb.transaction((items: OrderPiiRow[]) => {
    for (const r of items) {
      stmt.run(
        r.tenantId,
        String(r.platform || '').toUpperCase(),
        r.shopKey,
        r.orderNo,
        cleanStr(r.buyerName),
        cleanStr(r.buyerPhone),
        cleanStr(r.fullAddress),
        cleanStr(r.postalCode),
        now,
        now,
      )
    }
  })
  tx(rows)
}

/**
 * ลบข้อมูล PII เฉพาะ order_no ที่ระบุ (ใช้สำหรับชดเชยเมื่อ transaction ฐานหลักล้มเหลว เพื่อไม่ให้เกิดแถวค้างใน pii.db)
 */
export function deleteOrderPii(tenantId: string, platform: string, shopKey: string, orderNos: string[]): number {
  if (!orderNos || orderNos.length === 0) return 0
  const placeholders = orderNos.map(() => '?').join(',')
  const res = piiDb.prepare(`
    DELETE FROM online_order_pii
    WHERE tenant_id = ? AND platform = ? AND shop_key = ? AND order_no IN (${placeholders})
  `).run(tenantId, String(platform || '').toUpperCase(), shopKey, ...orderNos)
  return Number(res.changes) || 0
}

/**
 * ลบข้อมูล PII ทั้งหมดของ tenant (เรียกตอน purge tenant)
 */
export function deleteTenantPii(tenantId: string): number {
  const res = piiDb.prepare('DELETE FROM online_order_pii WHERE tenant_id = ?').run(tenantId)
  return Number(res.changes) || 0
}

/**
 * สร้าง snapshot ของ pii.db ด้วย better-sqlite3 backup API ไปยัง destPath (ใช้ในเครื่องเท่านั้น ห้ามอัป Drive)
 */
export async function backupPiiTo(destPath: string): Promise<void> {
  const dir = path.dirname(destPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  await piiDb.backup(destPath)
}
