import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { generateId } from '../utils/id'
import { piiDb, piiDbPath, upsertOrderPii, deleteTenantPii, backupPiiTo } from './piiConnection'

const tenants: string[] = []
afterEach(() => {
  for (const t of tenants.splice(0)) {
    deleteTenantPii(t)
  }
})

function newTenant() {
  const t = 'test_pii_' + generateId()
  tenants.push(t)
  return t
}

describe('piiConnection — ฐานข้อมูล PII แยกไฟล์ (pii.db)', () => {
  it('เปิดฐานทดสอบแยกไฟล์และตั้ง PRAGMA user_version = 1', () => {
    expect(path.basename(piiDbPath)).toContain('test')
    expect(Number(piiDb.pragma('user_version', { simple: true }))).toBe(1)
  })

  it('upsertOrderPii บันทึกและอัปเดตแบบ idempotent โดยไม่สร้างแถวซ้ำ', () => {
    const t = newTenant()
    upsertOrderPii([
      {
        tenantId: t,
        platform: 'SHOPEE',
        shopKey: 'bebozch',
        orderNo: 'ORD-001',
        buyerName: 'ธัชพงษ์',
        buyerPhone: '081-234-5678',
        fullAddress: 'เลขที่ 858/7 หมู่ที่ 4 จังหวัดชัยภูมิ 36000',
        postalCode: '36000',
      },
    ])

    upsertOrderPii([
      {
        tenantId: t,
        platform: 'SHOPEE',
        shopKey: 'bebozch',
        orderNo: 'ORD-001',
        buyerName: 'ทีปกร สะอาดถิ่น',
        buyerPhone: '089-999-1234',
      },
    ])

    const rows = piiDb.prepare('SELECT * FROM online_order_pii WHERE tenant_id = ?').all(t) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].buyer_name).toBe('ทีปกร สะอาดถิ่น')
    expect(rows[0].buyer_phone).toBe('089-999-1234')
    // ฟิลด์ที่ไม่ได้ส่งในการอัปเดตรอบสองยังคงค่าเดิมไว้
    expect(rows[0].full_address).toBe('เลขที่ 858/7 หมู่ที่ 4 จังหวัดชัยภูมิ 36000')
    expect(rows[0].postal_code).toBe('36000')
  })

  it('deleteTenantPii ลบเฉพาะของเทแนนต์นั้น ไม่กระทบเทแนนต์อื่น', () => {
    const tA = newTenant()
    const tB = newTenant()

    upsertOrderPii([
      { tenantId: tA, platform: 'SHOPEE', shopKey: 's1', orderNo: 'A1', buyerName: 'สมชาย' },
      { tenantId: tA, platform: 'SHOPEE', shopKey: 's1', orderNo: 'A2', buyerName: 'สมหญิง' },
      { tenantId: tB, platform: 'SHOPEE', shopKey: 's1', orderNo: 'B1', buyerName: 'วิชัย' },
    ])

    const deleted = deleteTenantPii(tA)
    expect(deleted).toBe(2)

    const remainA = piiDb.prepare('SELECT COUNT(*) AS c FROM online_order_pii WHERE tenant_id = ?').get(tA) as any
    const remainB = piiDb.prepare('SELECT COUNT(*) AS c FROM online_order_pii WHERE tenant_id = ?').get(tB) as any
    expect(remainA.c).toBe(0)
    expect(remainB.c).toBe(1)
  })

  it('backupPiiTo สร้างไฟล์ snapshot SQLite ที่อ่านข้อมูลได้จริง', async () => {
    const t = newTenant()
    upsertOrderPii([
      { tenantId: t, platform: 'SHOPEE', shopKey: 'bebozch', orderNo: 'BK-1', buyerName: 'ธัชพงษ์', buyerPhone: '081-234-5678' },
    ])

    const dest = path.join(os.tmpdir(), `phopy-pii-test-snap-${generateId()}.db`)
    try {
      await backupPiiTo(dest)
      expect(fs.existsSync(dest)).toBe(true)
      const snapDb: any = new Database(dest, { readonly: true })
      try {
        const row = snapDb.prepare('SELECT buyer_name, buyer_phone FROM online_order_pii WHERE tenant_id = ? AND order_no = ?').get(t, 'BK-1') as any
        expect(row).toEqual({ buyer_name: 'ธัชพงษ์', buyer_phone: '081-234-5678' })
      } finally {
        snapDb.close()
      }
    } finally {
      try { fs.unlinkSync(dest) } catch {}
    }
  })
})
