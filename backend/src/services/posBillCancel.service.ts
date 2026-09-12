import db from '../db/sqlite'
import posStockService from './pos-stock.service'
import posAccountingService from './pos-accounting.service'

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

  return { bill, stockResult, accountingResult }
}
