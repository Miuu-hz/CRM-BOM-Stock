import db from '../db/sqlite'
import posStockService from './pos-stock.service'
import posAccountingService from './pos-accounting.service'
import { generateId } from '../utils/id'

/**
 * ยกเลิกบิล POS — คืนสต็อก + กลับรายการบัญชี + ปิดสถานะบิล
 *
 * เดิมมี 2 ทางที่ทำเรื่องเดียวกันคนละแบบ:
 *   POST /pos/bills/:id/cancel  → เรียก service (มี idempotency guard, เด้งรายได้ไป 4302)
 *   POST /sales/pos-running-bills/:id/void → เขียน journal reversal เองในไฟล์ route
 *     (สลับ debit/credit บน 4101 ตรงๆ, ไม่มี guard กันลงซ้ำ, อัปเดตสถานะบิลก่อนคืนของ
 *      ถ้าพังกลางคันบิลค้าง VOID โดยไม่มีของคืนและ retry ไม่ได้)
 * ตอนนี้ทั้งคู่ + ตัว executor ของระบบอนุมัติ เรียกฟังก์ชันนี้ตัวเดียวกัน
 */
export async function cancelPosBill(
  tenantId: string,
  userId: string,
  billId: string,
  reason: string | undefined,
  finalStatus: 'CANCELLED' | 'VOID' = 'CANCELLED'
) {
  const bill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?')
    .get(billId, tenantId) as any
  if (!bill) throw new Error('BILL_NOT_FOUND')

  // 1. คืนสต็อก (กันคืนซ้ำด้วย pos_stock_deductions.returned ในตัว service เอง)
  const stockResult = await posStockService.returnStockOnCancel(billId, tenantId, userId, reason)
  if (!stockResult.success) {
    console.warn(`[pos-cancel] stock return warnings for bill ${billId}:`, stockResult.errors)
  }

  // 2. กลับรายการบัญชี (มี guard กันลงซ้ำในตัว service เอง)
  const accountingResult = await posAccountingService.recordCancelledSale(bill, tenantId, userId, reason)

  // 2.5 คืนแต้มสะสม (มี guard กันคืนซ้ำในตัวเอง เหมือนสองขั้นด้านบน)
  const pointsResult = reverseLoyaltyPoints(bill, tenantId, userId)

  // 3. ปิดสถานะบิล — ทำเป็นขั้นสุดท้ายเสมอ ถ้าขั้นบนพังกลางคันจะยัง retry ได้
  const now = new Date().toISOString()
  if (finalStatus === 'VOID') {
    const voidNote = reason ? `[VOID] ${reason}` : '[VOID]'
    db.prepare(`
      UPDATE pos_running_bills
      SET status = 'VOID', notes = TRIM(COALESCE(notes, '') || ' ' || ?)
      WHERE id = ? AND tenant_id = ?
    `).run(voidNote, billId, tenantId)
  } else {
    db.prepare(`
      UPDATE pos_running_bills
      SET status = 'CANCELLED', closed_at = ?, closed_by = ?,
          notes = COALESCE(?, notes) || ' [CANCELLED: ' || ? || ']'
      WHERE id = ? AND tenant_id = ?
    `).run(now, userId, bill.notes, reason || 'No reason', billId, tenantId)
  }

  return { bill, stockResult, accountingResult, pointsResult }
}

/**
 * คืนแต้มสะสม + total_spent ที่เคยปรับตอนจ่ายบิลนี้ (EARN ตอนจ่าย → หักออก,
 * REDEEM ตอนจ่าย → คืนกลับ) รวมเป็นแถวเดียวประเภท 'CANCEL' ผูก bill_id เดิม
 * — แถวนี้เองคือ idempotency guard: มีแล้วไม่ทำซ้ำ (เหมือน stock/accounting ด้านบน)
 * บิลไม่มีลูกค้า หรือลูกค้าถูกลบไปแล้ว ก็แค่ไม่มีอะไรให้กลับ ไม่ throw
 *
 * หมายเหตุ: ตาราง crm_points_transactions นี้ยังไม่มีหน้าเว็บไหนอ่านออกไปแสดงผล
 * (CRM.tsx ฝั่ง frontend อ่านคนละตาราง loyalty_transactions ผ่าน /customers/:id/loyalty)
 * เลยไม่ต้องเพิ่มคำแปล type ใหม่ที่ไหน — ใช้ค่า 'CANCEL' ใหม่แยกจาก EARN/REDEEM ปกติ
 * เพื่อไม่ให้รายงานในอนาคตนับรวมการยกเลิกเป็นการแลกแต้ม/สะสมแต้มจริง
 */
function reverseLoyaltyPoints(bill: any, tenantId: string, userId: string) {
  try {
    const already = db.prepare(`
      SELECT id FROM crm_points_transactions WHERE tenant_id = ? AND bill_id = ? AND type = 'CANCEL'
    `).get(tenantId, bill.id)
    if (already) return { success: true, skipped: true }

    const original = db.prepare(`
      SELECT * FROM crm_points_transactions WHERE tenant_id = ? AND bill_id = ? AND type IN ('EARN', 'REDEEM')
    `).all(tenantId, bill.id) as any[]
    if (original.length === 0) return { success: true, skipped: true }

    const customerId = original[0].customer_id
    const customer = db.prepare('SELECT loyalty_points, total_spent FROM customers WHERE id = ? AND tenant_id = ?')
      .get(customerId, tenantId) as any
    if (!customer) return { success: true, skipped: true } // ลูกค้าถูกลบไปแล้ว

    const delta = original.reduce((sum, tx) => sum + (tx.type === 'EARN' ? -tx.points : tx.points), 0)
    const balanceBefore = customer.loyalty_points || 0
    const balanceAfter = Math.max(0, balanceBefore + delta)
    const spentAfter = Math.max(0, (customer.total_spent || 0) - (bill.total_amount || 0))

    // แถว CANCEL คือ guard กันคืนซ้ำ ถ้ามันเขียนไม่ติดหลังจากแต้มถูกปรับไปแล้ว
    // รอบหน้าจะคืนแต้มซ้ำอีกรอบ — มัดสองคำสั่งไว้ด้วยกัน ล้มก็ล้มทั้งคู่
    db.transaction(() => {
      db.prepare('UPDATE customers SET loyalty_points = ?, total_spent = ? WHERE id = ? AND tenant_id = ?')
        .run(balanceAfter, spentAfter, customerId, tenantId)

      db.prepare(`
        INSERT INTO crm_points_transactions (id, tenant_id, customer_id, bill_id, type, points, balance_before, balance_after, description, created_by, created_at)
        VALUES (?, ?, ?, ?, 'CANCEL', ?, ?, ?, ?, ?, ?)
      `).run(
        generateId(), tenantId, customerId, bill.id,
        delta, balanceBefore, balanceAfter,
        `ยกเลิกบิล ${bill.bill_number} — คืนแต้มสะสมที่เคยปรับไว้`,
        userId, new Date().toISOString()
      )
    })()
    return { success: true, delta }
  } catch (e: any) {
    console.warn(`[pos-cancel] loyalty points reversal failed for bill ${bill.id}:`, e.message)
    return { success: false, error: e.message }
  }
}
