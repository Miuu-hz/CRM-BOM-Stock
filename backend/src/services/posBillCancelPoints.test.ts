import { describe, it, expect, afterEach } from 'vitest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import { cancelPosBill } from './posBillCancel.service'

// เทสต์ยิงใส่ dev.db ตัวจริง (ผ่าน SQLITE_DB_PATH ของ vitest.config.ts) — ใช้ tenant ทิ้งแล้วลบทุกครั้ง
const tenants: string[] = []
function setupTenant() {
  const t = 'test_poscancel_' + generateId()
  tenants.push(t)
  db.prepare('INSERT INTO company_settings (tenant_id, name) VALUES (?, ?)').run(t, 'test')
  return t
}

function addCustomer(tenantId: string, loyaltyPoints: number, totalSpent: number) {
  const id = generateId()
  db.prepare(`
    INSERT INTO customers (id, tenant_id, code, name, type, contact_name, email, phone, city, status, loyalty_points, total_spent)
    VALUES (?, ?, ?, 'test cust', 'RETAIL', '-', '-', '-', '-', 'ACTIVE', ?, ?)
  `).run(id, tenantId, id, loyaltyPoints, totalSpent)
  return id
}

// สร้างบิลที่จ่ายเงินแล้ว (PAID) พร้อมแถวแต้มจากตอนจ่าย เหมือนที่ pos-bill.routes.ts ทำจริง
function seedPaidBill(
  tenantId: string,
  customerId: string | null,
  totalAmount: number,
  pointsEarned: number,
  pointsRedeemed: number,
  balanceAfterPayment: number
) {
  const billId = generateId()
  db.prepare(`
    INSERT INTO pos_running_bills (id, tenant_id, bill_number, display_name, status, created_by, customer_id, total_amount)
    VALUES (?, ?, ?, 'Test Bill', 'PAID', 'tester', ?, ?)
  `).run(billId, tenantId, `POS-TEST-${billId}`, customerId, totalAmount)

  if (customerId) {
    const balanceBeforeRedeem = balanceAfterPayment - pointsEarned + pointsRedeemed
    if (pointsRedeemed > 0) {
      db.prepare(`
        INSERT INTO crm_points_transactions (id, tenant_id, customer_id, bill_id, type, points, balance_before, balance_after, description, created_by, created_at)
        VALUES (?, ?, ?, ?, 'REDEEM', ?, ?, ?, 'test redeem', 'tester', datetime('now'))
      `).run(generateId(), tenantId, customerId, billId, pointsRedeemed, balanceBeforeRedeem, balanceBeforeRedeem - pointsRedeemed)
    }
    db.prepare(`
      INSERT INTO crm_points_transactions (id, tenant_id, customer_id, bill_id, type, points, balance_before, balance_after, description, created_by, created_at)
      VALUES (?, ?, ?, ?, 'EARN', ?, ?, ?, 'test earn', 'tester', datetime('now'))
    `).run(generateId(), tenantId, customerId, billId, pointsEarned, balanceBeforeRedeem - pointsRedeemed, balanceAfterPayment)
  }
  return billId
}

afterEach(() => {
  for (const t of tenants.splice(0)) {
    db.prepare('DELETE FROM crm_points_transactions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM pos_stock_deductions WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM pos_bill_items WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM pos_running_bills WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM journal_lines WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM journal_entries WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM customers WHERE tenant_id = ?').run(t)
    db.prepare('DELETE FROM company_settings WHERE tenant_id = ?').run(t)
  }
})

describe('cancelPosBill — คืนแต้มสะสมเมื่อยกเลิกบิล', () => {
  it('ยกเลิกบิลที่เคยให้แต้ม → แต้มกลับไปเท่าก่อนจ่ายเงิน และ total_spent ลดลง', async () => {
    const t = setupTenant()
    const customerId = addCustomer(t, /* ก่อนจ่าย */ 50, /* total_spent ก่อนบิลนี้ */ 500)
    const billId = seedPaidBill(t, customerId, 100, /* pointsEarned */ 10, 0, /* balanceAfterPayment */ 60)
    // จำลอง loyalty_points/total_spent ที่ถูกบวกไปตอนจ่ายจริง (pos-bill.routes.ts ทำตอน payment)
    db.prepare('UPDATE customers SET loyalty_points = 60, total_spent = 600 WHERE id = ?').run(customerId)

    await cancelPosBill(t, 'tester', billId, 'ทดสอบยกเลิก')

    const customer = db.prepare('SELECT loyalty_points, total_spent FROM customers WHERE id = ?').get(customerId) as any
    expect(customer.loyalty_points).toBe(50)
    expect(customer.total_spent).toBe(500)

    const cancelTx = db.prepare(`SELECT * FROM crm_points_transactions WHERE bill_id = ? AND type = 'CANCEL'`).get(billId) as any
    expect(cancelTx).toBeTruthy()
    expect(cancelTx.points).toBe(-10)
  })

  it('บิลที่มีการแลกแต้มด้วย → ได้แต้มที่แลกไปคืน (พร้อมหักแต้มที่เคยได้จากบิลนี้ออก)', async () => {
    const t = setupTenant()
    // ก่อนบิลนี้: 100 แต้ม → แลก 30 (เหลือ 70) → ได้จากบิลนี้ 5 → หลังจ่าย 75
    const customerId = addCustomer(t, 75, 1000)
    const billId = seedPaidBill(t, customerId, 50, /* pointsEarned */ 5, /* pointsRedeemed */ 30, /* balanceAfterPayment */ 75)
    db.prepare('UPDATE customers SET total_spent = 1050 WHERE id = ?').run(customerId)

    await cancelPosBill(t, 'tester', billId, 'ทดสอบยกเลิก')

    const customer = db.prepare('SELECT loyalty_points, total_spent FROM customers WHERE id = ?').get(customerId) as any
    // คืน: -5 (หักที่เคยได้) + 30 (คืนที่เคยแลก) = +25 -> 75 + 25 = 100
    expect(customer.loyalty_points).toBe(100)
    expect(customer.total_spent).toBe(1000)
  })

  it('ยกเลิกซ้ำ (idempotent) → แต้มไม่เปลี่ยนเพิ่มรอบสอง', async () => {
    const t = setupTenant()
    const customerId = addCustomer(t, 20, 200)
    const billId = seedPaidBill(t, customerId, 100, 10, 0, 30)
    db.prepare('UPDATE customers SET total_spent = 300 WHERE id = ?').run(customerId)

    await cancelPosBill(t, 'tester', billId, 'ครั้งที่ 1')
    const after1 = db.prepare('SELECT loyalty_points, total_spent FROM customers WHERE id = ?').get(customerId) as any

    await cancelPosBill(t, 'tester', billId, 'ครั้งที่ 2')
    const after2 = db.prepare('SELECT loyalty_points, total_spent FROM customers WHERE id = ?').get(customerId) as any

    expect(after2.loyalty_points).toBe(after1.loyalty_points)
    expect(after2.total_spent).toBe(after1.total_spent)

    const cancelCount = db.prepare(`SELECT COUNT(*) c FROM crm_points_transactions WHERE bill_id = ? AND type = 'CANCEL'`).get(billId) as any
    expect(cancelCount.c).toBe(1)
  })

  it('บิลไม่มีลูกค้าผูก → ไม่ throw และไม่มีแถวแต้มเกิดขึ้น', async () => {
    const t = setupTenant()
    const billId = seedPaidBill(t, null, 100, 0, 0, 0)

    await expect(cancelPosBill(t, 'tester', billId, 'ไม่มีลูกค้า')).resolves.toBeTruthy()

    const cancelCount = db.prepare(`SELECT COUNT(*) c FROM crm_points_transactions WHERE bill_id = ?`).get(billId) as any
    expect(cancelCount.c).toBe(0)
  })

  it('ลูกค้าถูกลบไปแล้วหลังจ่ายบิล → ไม่ throw ตอนยกเลิก', async () => {
    const t = setupTenant()
    const customerId = addCustomer(t, 10, 100)
    const billId = seedPaidBill(t, customerId, 100, 10, 0, 20)
    // จำลองลูกค้าที่ถูกลบไปแล้วแต่ bill/crm_points_transactions เก่ายังอ้างถึง id นี้อยู่ (FK กำพร้า
    // แบบที่เจอจริงในโปรดักชัน — ต้องปิด FK ชั่วคราวเพื่อสร้างสถานการณ์นี้ในเทสต์)
    db.pragma('foreign_keys = OFF')
    db.prepare('DELETE FROM customers WHERE id = ?').run(customerId)
    db.pragma('foreign_keys = ON')

    await expect(cancelPosBill(t, 'tester', billId, 'ลูกค้าถูกลบ')).resolves.toBeTruthy()
  })
})
