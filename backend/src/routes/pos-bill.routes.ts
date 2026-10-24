import { Router } from 'express'
import { calcPosTotals } from '../utils/posVat'
import db from '../db/sqlite'
import posStockService from '../services/pos-stock.service'
import posAccountingService from '../services/pos-accounting.service'
import { cancelPosBill } from '../services/posBillCancel.service'
import { getLoyaltySettings } from '../services/loyaltySettings'
import { mintQrToken } from '../services/posQr.service'
import { verifyBillMember } from '../services/posMember.service'
import { recordPaidBill } from '../services/posGuest.service'
import { billRewardConflict, useBillRewards, reservedPoints, availablePoints, InsufficientPointsError } from '../services/qrRewards.service'
import { gateOrCreate, recordAutoAction, isApprovalRequired, hasBypass, findPendingRequest, createRequest, posDiscountApprovalPct } from '../services/approvalGate.service'

export { InsufficientPointsError }

// ลด/ลบรายการที่ส่งครัวแล้ว = ของอาจเสิร์ฟไปแล้วแต่ไม่อยู่ในบิล → ต้องมีเหตุผล + ลงบันทึกความเคลื่อนไหว
// คืน false = ตอบ 400 ไปแล้ว ผู้เรียกหยุด · ถ้ารายการยังไม่ส่งครัว แก้ได้อิสระไม่ต้องบันทึก
function guardKitchenItemChange(req: any, res: any, billId: string, item: any, newQty: number): boolean {
  if (!item.sent_to_kds || newQty >= item.quantity) return true
  const reason = String(req.body?.reason ?? req.query?.reason ?? '').trim()
  if (!reason) {
    res.status(400).json({ success: false, code: 'REASON_REQUIRED', message: `${item.product_name} ส่งครัวไปแล้ว — ต้องระบุเหตุผลที่ลด/ลบรายการ` })
    return false
  }
  const bill = db.prepare('SELECT bill_number FROM pos_running_bills WHERE id = ?').get(billId) as any
  const removed = item.quantity - newQty
  recordAutoAction({
    tenantId: req.user.tenantId, user: req.user, category: 'pos_item_void',
    refType: 'pos_bill_items', refId: item.id, amount: removed * (item.unit_price || 0),
    description: `บิล ${bill?.bill_number ?? billId} ${newQty === 0 ? 'ลบ' : 'ลด'} ${item.product_name} ${item.quantity}→${newQty} หลังส่งครัว เพราะ ${reason}`,
    payload: { severity: 'medium', billId, itemId: item.id, from: item.quantity, to: newQty, reason },
  })
  // ให้ตั๋วครัวที่ยังไม่เสร็จเห็นด้วย: quantity ในตั๋ว = จำนวนตอนส่ง, void_qty = ส่วนที่ยกเลิกไปแล้วเทียบกับตอนส่ง
  const ts = new Date().toISOString()
  const active = `SELECT id FROM pos_kds_tickets WHERE tenant_id = ? AND status IN ('PENDING', 'IN_PROGRESS')`
  db.prepare(`UPDATE pos_kds_ticket_items
    SET void_qty = MIN(quantity, MAX(0, quantity - ?)), void_reason = ?,
        status = CASE WHEN ? <= 0 THEN 'CANCELLED' ELSE status END
    WHERE bill_item_id = ? AND ticket_id IN (${active})`).run(newQty, reason, newQty, item.id, req.user.tenantId)
  db.prepare(`UPDATE pos_kds_tickets SET updated_at = ?
    WHERE id IN (SELECT ticket_id FROM pos_kds_ticket_items WHERE bill_item_id = ?) AND id IN (${active})`)
    .run(ts, item.id, req.user.tenantId)
  return true
}
import { authenticate } from '../middleware/auth.middleware'
import { generateId, formatDocumentNumber, thaiDateStr } from '../utils/id'
import { getOrCreateReceiptToken, buildReceiptUrl, buildReceiptQr } from '../utils/receiptToken'
import { createInvoiceFromPosBill, findActiveInvoiceForPosBill, SalesBillingError } from '../services/salesBilling.service'
import { canHandleBilling } from '../services/rbac.service'

const router = Router()

router.use(authenticate)

// Helper: Get current timestamp
const now = () => new Date().toISOString()

// Helper: Generate bill number (POS-2024-00001)
const generateBillNumber = (tenantId: string) => {
  return formatDocumentNumber('POS', tenantId, 'POS_BILL', new Date().getFullYear(), 5)
}

// ==================== SHIFT GATE ====================

// ขายได้เฉพาะตอนมีกะเปิดอยู่ (บังคับทุก tenant ไม่ขึ้นกับ company_settings.require_pos_shift)
export function getOpenShift(tenantId: string) {
  return db.prepare(`SELECT id, opened_at FROM pos_shifts WHERE tenant_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`)
    .get(tenantId) as { id: string; opened_at: string } | undefined
}

/** คืนกะที่เปิดอยู่ หรือส่ง 403/409 แล้วคืน null
 *  กะค้างจากวันก่อน (เวลาไทย) ห้ามเปิดบิลใหม่ แต่ยังรับเงินบิลเดิมได้ (allowStale)
 *  ไม่งั้นแคชเชียร์เคลียร์บิลค้างไม่ได้ → ปิดกะเดิมไม่ได้ (ติดล็อก) */
function requireSellableShift(tenantId: string, res: any, allowStale = false) {
  const shift = getOpenShift(tenantId)
  if (!shift) {
    res.status(403).json({ success: false, code: 'SHIFT_NOT_OPEN', message: 'กรุณาเปิดกะก่อนขาย/รับชำระเงิน' })
    return null
  }
  if (!allowStale && thaiDateStr(shift.opened_at) < thaiDateStr()) {
    res.status(409).json({ success: false, code: 'SHIFT_STALE', message: 'กะที่เปิดอยู่เป็นของวันก่อน กรุณาปิดกะเดิมแล้วเปิดกะใหม่ก่อนขาย' })
    return null
  }
  return shift
}

// ==================== BILLS ====================

// Get all bills
router.get('/bills', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { status } = req.query
    
    let query = `
      SELECT
        b.*,
        COUNT(bi.id) as item_count,
        SUM(bi.quantity) as total_items,
        (SELECT i.invoice_number FROM invoices i
          WHERE i.pos_bill_id = b.id AND i.tenant_id = b.tenant_id AND i.status != 'CANCELLED' LIMIT 1) AS invoice_number
      FROM pos_running_bills b
      LEFT JOIN pos_bill_items bi ON b.id = bi.bill_id
      WHERE b.tenant_id = ?
    `
    const params: any[] = [tenantId]
    
    if (status) {
      query += ' AND b.status = ?'
      params.push(status)
    }
    
    query += ' GROUP BY b.id ORDER BY b.opened_at DESC'
    
    const stmt = db.prepare(query)
    const bills = stmt.all(...params)
    
    res.json({ success: true, data: bills })
  } catch (error) {
    console.error('Error fetching bills:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch bills' })
  }
})

// Get open bills only
router.get('/bills/open', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    
    const stmt = db.prepare(`
      SELECT 
        b.*,
        COUNT(bi.id) as item_count,
        SUM(bi.quantity) as total_items
      FROM pos_running_bills b
      LEFT JOIN pos_bill_items bi ON b.id = bi.bill_id
      WHERE b.tenant_id = ? AND b.status = 'OPEN'
      GROUP BY b.id
      ORDER BY b.opened_at DESC
    `)
    
    const bills = stmt.all(tenantId) as any[]
    // Recalculate totals for open bills so they reflect current POS billing settings
    for (const bill of bills) {
      recalculateBillTotals(bill.id)
    }
    // Re-fetch to get updated totals
    const refreshedBills = stmt.all(tenantId)
    res.json({ success: true, data: refreshedBills })
  } catch (error) {
    console.error('Error fetching open bills:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch open bills' })
  }
})

// Get single bill with items
router.get('/bills/:id', async (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params

    // Get bill (JOIN customer loyalty_points + ข้อมูลสำหรับพิมพ์ใบกำกับภาษี)
    // ⚠️ ห้ามตั้ง alias ว่า customer_name เฉย ๆ เพราะ b.* มีคอลัมน์ customer_name อยู่แล้ว
    // ชื่อซ้ำกันตัวหลังทับตัวหน้า = เอา null ไปทับชื่อจริง (ดูคอมเมนต์เดียวกันใน sales/invoices.ts GET /:id)
    // member_device_verified_at: สมาชิกที่ผูกมาจากมือถือลูกค้า (QR) — NULL ทั้งที่มี member_device_id = รอแคชเชียร์ยืนยัน
    const billStmt = db.prepare(`
      SELECT b.*, c.loyalty_points as customer_loyalty_points,
        c.name as customer_name_crm, c.code as customer_code, c.tax_id as customer_tax_id,
        c.address as customer_address, c.tax_branch as customer_tax_branch,
        d.verified_at as member_device_verified_at
      FROM pos_running_bills b
      LEFT JOIN customers c ON b.customer_id = c.id
      LEFT JOIN pos_member_devices d ON d.id = b.member_device_id
      WHERE b.id = ? AND b.tenant_id = ?
    `)
    const bill = billStmt.get(id, tenantId)

    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' })
    }

    // Get items
    const itemsStmt = db.prepare(`
      SELECT
        bi.*,
        pmc.pos_price as current_price
      FROM pos_bill_items bi
      LEFT JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
      WHERE bi.bill_id = ?
      ORDER BY bi.added_at ASC
    `)
    const items = itemsStmt.all(id)

    // Paperless receipt: lazily mint/reuse a public share token + QR for this bill
    const receiptToken = getOrCreateReceiptToken('pos_bill', id, tenantId)
    const receipt_url = buildReceiptUrl(receiptToken)
    const receipt_qr = await buildReceiptQr(receiptToken)

    // บอกหน้าจอว่าบิลนี้ออกใบกำกับไปแล้วหรือยัง (ถ้าออกแล้ว frontend ต้องล็อกปุ่มแก้ผู้ซื้อ/ออกซ้ำ)
    const activeInvoice = findActiveInvoiceForPosBill(tenantId, id) as any
    const invoice = activeInvoice
      ? { id: activeInvoice.id, invoice_number: activeInvoice.invoice_number, status: activeInvoice.status }
      : null

    const customer_reserved_points = (bill as any)?.customer_id
      ? reservedPoints(tenantId, (bill as any).customer_id)
      : 0

    res.json({ success: true, data: { ...bill, customer_reserved_points, items, receipt_url, receipt_qr, invoice } })
  } catch (error) {
    console.error('Error fetching bill:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch bill' })
  }
})

// Create new bill
router.post('/bills', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const userId = (req as any).user!.userId
    const { display_name, customer_name, customer_phone, customer_id, notes, table_id } = req.body

    const openShift = requireSellableShift(tenantId, res)
    if (!openShift) return

    // เปิดโต๊ะ = บิลที่ผูกโต๊ะ + QR ของรอบนี้ (ลูกค้าสแกนสั่งเองได้ ดู routes/qr-public.routes.ts)
    let table: { id: string; name: string } | undefined
    if (table_id) {
      table = db.prepare('SELECT id, name FROM pos_tables WHERE id = ? AND tenant_id = ? AND is_active = 1').get(table_id, tenantId) as any
      if (!table) return res.status(404).json({ success: false, message: 'ไม่พบโต๊ะนี้' })
    }

    // If customer_id provided, pull name/phone from CRM
    let resolvedCustomerName = customer_name || null
    let resolvedCustomerPhone = customer_phone || null
    if (customer_id) {
      const cust = db.prepare('SELECT name, phone FROM customers WHERE id = ? AND tenant_id = ?').get(customer_id, tenantId) as any
      if (cust) {
        resolvedCustomerName = resolvedCustomerName || cust.name
        resolvedCustomerPhone = resolvedCustomerPhone || cust.phone
      }
    }

    const id = generateId()
    const billNumber = generateBillNumber(tenantId)
    const defaultDisplayName = table?.name || display_name || `บิล ${billNumber.split('-')[2]}`

    // Tag the bill with the open shift so shift-close can sum sales by shift_id
    db.prepare(`
      INSERT INTO pos_running_bills (
        id, tenant_id, bill_number, display_name, customer_name, customer_phone,
        customer_id, status, opened_at, notes, created_by, shift_id, table_id, qr_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, billNumber, defaultDisplayName,
      resolvedCustomerName, resolvedCustomerPhone, customer_id || null,
      now(), notes || null, userId, openShift.id,
      table?.id || null, table ? mintQrToken() : null
    )

    res.json({
      success: true,
      message: 'Bill created successfully',
      data: {
        id,
        bill_number: billNumber,
        display_name: defaultDisplayName,
      }
    })
  } catch (error: any) {
    // idx_pos_bills_open_table: อีกเครื่องเปิดโต๊ะนี้ไปก่อนแล้ว
    if (String(error?.code).startsWith('SQLITE_CONSTRAINT') && req.body?.table_id) {
      const open = db.prepare(`SELECT id FROM pos_running_bills WHERE tenant_id = ? AND table_id = ? AND status = 'OPEN'`)
        .get((req as any).user!.tenantId, req.body.table_id) as any
      return res.status(409).json({ success: false, code: 'TABLE_ALREADY_OPEN', message: 'โต๊ะนี้เปิดอยู่แล้ว', data: { bill_id: open?.id } })
    }
    console.error('Error creating bill:', error)
    res.status(500).json({ success: false, message: 'Failed to create bill' })
  }
})

// Update bill (display_name, customer, notes)
router.put('/bills/:id', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    const { display_name, customer_name, customer_phone, notes } = req.body
    
    const stmt = db.prepare(`
      UPDATE pos_running_bills 
      SET display_name = ?, customer_name = ?, customer_phone = ?, notes = ?
      WHERE id = ? AND tenant_id = ? AND status = 'OPEN'
    `)
    
    const result = stmt.run(
      display_name, customer_name || null, customer_phone || null, notes || null,
      id, tenantId
    )
    
    if (result.changes === 0) {
      return res.status(400).json({ success: false, message: 'Bill not found or already closed' })
    }
    
    res.json({ success: true, message: 'Bill updated successfully' })
  } catch (error) {
    console.error('Error updating bill:', error)
    res.status(500).json({ success: false, message: 'Failed to update bill' })
  }
})

// Assign or remove CRM member on open bill
router.patch('/bills/:id/member', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    const { customer_id } = req.body  // null to unassign

    // เดิมแก้ผู้ซื้อได้เฉพาะบิล OPEN เท่านั้น — บิลจ่ายเงินแล้ว (PAID) แก้ชื่อลูกค้าไม่ได้เลย
    // ซึ่งเป็นปัญหาต้นเรื่องทั้งหมด ตอนนี้ยอมทั้ง OPEN และ PAID แต่กันเพิ่ม 2 ชั้นข้างล่าง
    const bill = db.prepare('SELECT id, status, bill_number, total_amount, customer_id FROM pos_running_bills WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any
    // ชั้นที่ 1: บิลไม่พบ หรือถูกยกเลิกไปแล้ว (สถานะที่เหลือมีแค่ OPEN/PAID/CANCELLED) — แก้ผู้ซื้อไม่ได้
    if (!bill || (bill.status !== 'OPEN' && bill.status !== 'PAID')) {
      return res.status(400).json({
        success: false,
        message: bill?.status === 'CANCELLED' ? 'บิลนี้ถูกยกเลิกแล้ว แก้ข้อมูลลูกค้าไม่ได้' : 'บิลไม่พบหรือปิดแล้ว',
      })
    }
    // ชั้นที่ 2: "ยืนยันแล้วหมดสิทธิ์แก้" — บิลนี้ออกใบกำกับไปแล้ว ห้ามเปลี่ยนผู้ซื้ออีก
    // ต้องยกเลิกใบกำกับก่อน (ยกเลิกใบกำกับบังคับ ADMIN/MANAGER/MASTER อยู่แล้วใน invoices.ts PUT /:id/status)
    const activeInvoice = findActiveInvoiceForPosBill(tenantId, id) as any
    if (activeInvoice) {
      return res.status(409).json({
        success: false,
        message: `บิลนี้ออกใบกำกับ ${activeInvoice.invoice_number} ไปแล้ว เปลี่ยนผู้ซื้อไม่ได้ — ต้องยกเลิกใบกำกับก่อน`,
      })
    }

    const targetCustomerId = customer_id || null

    // กฎ (a): ถ้ามีประวัติแต้ม POS_BILL ผูกกับบิลนี้แล้ว และสมาชิกที่ส่งมาใหม่ไม่ตรงกับคนเดิม (รวมถึงการถอดสมาชิก)
    // ห้ามเปลี่ยน เพราะแต้มสะสมถูกโอนเข้าบัญชีสมาชิกคนแรกไปแล้ว
    const existingLoyaltyTx = db.prepare(`
      SELECT customer_id FROM loyalty_transactions
      WHERE tenant_id = ? AND reference_type = 'POS_BILL' AND reference_id = ?
      LIMIT 1
    `).get(tenantId, id) as any

    if (existingLoyaltyTx && existingLoyaltyTx.customer_id !== targetCustomerId) {
      return res.status(409).json({
        success: false,
        code: 'MEMBER_LOCKED_POINTS',
        message: 'แต้มสะสมจากบิลนี้ถูกบันทึกให้สมาชิกเดิมไปแล้ว ไม่สามารถเปลี่ยนสมาชิกได้ — หากต้องการแก้ไข ให้ยกเลิกบิลหรือปรับปรุงแต้มในระบบ CRM',
      })
    }

    let customerName = null
    let customerPhone = null

    if (targetCustomerId) {
      const cust = db.prepare('SELECT name, phone FROM customers WHERE id = ? AND tenant_id = ?').get(targetCustomerId, tenantId) as any
      if (!cust) return res.status(404).json({ success: false, message: 'ไม่พบสมาชิก' })
      customerName = cust.name
      customerPhone = cust.phone
    }

    // กฎ (b): ถ้าบิลจ่ายแล้ว (PAID) + ยังไม่มีแถว POS_BILL ใน loyalty_transactions + เปิดระบบแต้มอยู่ + กำลังผูกสมาชิก
    // คำนวณแต้มและบันทึกประวัติให้สมาชิกย้อนหลังใน transaction เดียวกัน (idempotent: เรียกซ้ำจะไม่แจกซ้ำเพราะเช็ค existingLoyaltyTx)
    const loyalty = getLoyaltySettings(tenantId)
    // เฉพาะบิลที่จ่ายตอนยังไม่มีสมาชิก — ถ้าเคยมีสมาชิกตอนจ่าย total_spent ถูกบวกให้คนนั้นไปแล้ว (แม้แต้มเป็น 0 จนไม่มีแถว POS_BILL)
    const shouldAwardPoints = bill.status === 'PAID' && !bill.customer_id && !existingLoyaltyTx && loyalty.enabled && Boolean(targetCustomerId)

    db.transaction(() => {
      // แคชเชียร์เลือก/เปลี่ยนสมาชิกเอง = ไม่ใช่สมาชิกที่ผูกจากมือถือลูกค้าแล้ว (ไม่ต้องรอยืนยัน)
      const result = db.prepare(`
        UPDATE pos_running_bills
        SET customer_id = ?, customer_name = ?, customer_phone = ?, member_device_id = NULL
        WHERE id = ? AND tenant_id = ? AND status IN ('OPEN', 'PAID')
      `).run(targetCustomerId, customerName, customerPhone, id, tenantId)

      if (result.changes === 0) {
        throw new Error('BILL_UPDATE_FAILED')
      }

      if (shouldAwardPoints && targetCustomerId) {
        const cust = db.prepare('SELECT loyalty_points, total_spent FROM customers WHERE id = ? AND tenant_id = ?').get(targetCustomerId, tenantId) as any
        const totalAmount = bill.total_amount || 0
        const pointsEarned = loyalty.earnRate > 0 ? Math.floor(totalAmount / loyalty.earnRate) : 0
        const balanceBefore = cust?.loyalty_points || 0
        const balanceAfter = balanceBefore + pointsEarned
        const totalSpentAfter = (cust?.total_spent || 0) + totalAmount

        db.prepare(`
          UPDATE customers SET loyalty_points = ?, total_spent = ? WHERE id = ? AND tenant_id = ?
        `).run(balanceAfter, totalSpentAfter, targetCustomerId, tenantId)

        const pointsBy = (req.user as any)?.email || (req as any).user?.userId || 'SYSTEM'
        db.prepare(`
          INSERT INTO loyalty_transactions (id, tenant_id, customer_id, type, points, balance_after, reference_type, reference_id, note, created_by, created_at)
          VALUES (?, ?, ?, 'EARN', ?, ?, 'POS_BILL', ?, ?, ?, ?)
        `).run(
          generateId(), tenantId, targetCustomerId,
          pointsEarned, balanceAfter, id,
          `สะสมแต้มจากบิล ${bill.bill_number}`,
          pointsBy, new Date().toISOString()
        )
      }
    })()

    // Return updated customer info
    const customer = targetCustomerId
      ? db.prepare('SELECT id, name, phone, loyalty_points, total_spent FROM customers WHERE id = ? AND tenant_id = ?').get(targetCustomerId, tenantId) as any
      : null

    res.json({ success: true, message: targetCustomerId ? 'เพิ่มสมาชิกสำเร็จ' : 'ยกเลิกสมาชิกสำเร็จ', data: { customer } })
  } catch (error: any) {
    if (error?.message === 'BILL_UPDATE_FAILED') {
      return res.status(400).json({ success: false, message: 'บิลไม่พบหรือปิดแล้ว' })
    }
    console.error('Assign member error:', error)
    res.status(500).json({ success: false, message: 'ไม่สามารถกำหนดสมาชิกได้' })
  }
})

// POST /bills/:id/verify-member — แคชเชียร์ยืนยันว่าลูกค้าที่โต๊ะเป็นเจ้าของเบอร์ที่สมัครผ่าน QR
// (แทน OTP) → มือถือเครื่องนั้นเห็นชื่อ/แต้ม และแลกแต้มได้
router.post('/bills/:id/verify-member', (req, res) => {
  try {
    const ok = verifyBillMember((req as any).user!.tenantId, req.params.id)
    if (!ok) return res.status(404).json({ success: false, message: 'บิลนี้ไม่มีสมาชิกที่สมัครผ่าน QR รอยืนยัน' })
    res.json({ success: true, message: 'ยืนยันสมาชิกแล้ว' })
  } catch (error) {
    console.error('Verify member error:', error)
    res.status(500).json({ success: false, message: 'ยืนยันสมาชิกไม่สำเร็จ' })
  }
})

// Delete bill (only if OPEN and no items)
router.delete('/bills/:id', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    
    // ได้เลขบิลไปแล้วตั้งแต่เปิดโต๊ะ = ห้ามหาย → ยกเลิกแทนการลบ (เลขบิลไม่ขาดช่วง)
    // Check if bill has items (scoped to tenant)
    const checkStmt = db.prepare(`
      SELECT COUNT(*) as count FROM pos_bill_items bi
      JOIN pos_running_bills b ON bi.bill_id = b.id
      WHERE bi.bill_id = ? AND b.tenant_id = ?
    `)
    const check = checkStmt.get(id, tenantId) as { count: number }
    
    if (check.count > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete bill with items. Please cancel instead.' 
      })
    }
    
    const stmt = db.prepare(`
      UPDATE pos_running_bills SET status = 'CANCELLED', closed_at = datetime('now'),
        notes = TRIM(COALESCE(notes, '') || ' [ยกเลิกบิลเปล่า]')
      WHERE id = ? AND tenant_id = ? AND status = 'OPEN'
    `)
    
    const result = stmt.run(id, tenantId)
    
    if (result.changes === 0) {
      return res.status(400).json({ success: false, message: 'Bill not found or already closed' })
    }
    
    res.json({ success: true, message: 'ยกเลิกบิลเปล่าแล้ว (เก็บเลขบิลไว้)' })
  } catch (error) {
    console.error('Error deleting bill:', error)
    res.status(500).json({ success: false, message: 'Failed to delete bill' })
  }
})

// ==================== BILL ITEMS ====================

// Add item to bill
// แก้รายการได้เฉพาะบิลที่ยังเปิด (OPEN) ของ tenant ตัวเอง — เดิมไม่เช็คเลย หน้าจอค้าง/MCP
// ยิงเพิ่มรายการเข้าบิลที่จ่ายแล้วได้ ยอดบิลเปลี่ยนทั้งที่ journal/VAT ลงไปแล้ว (เจอใน vatGolden)
// และเพิ่มเข้า bill id ของ tenant อื่นได้ด้วย
function findOpenBill(billId: string, tenantId: string) {
  return db.prepare(`SELECT id FROM pos_running_bills WHERE id = ? AND tenant_id = ? AND status = 'OPEN'`).get(billId, tenantId)
}
const BILL_NOT_OPEN = { success: false, message: 'ไม่พบบิล หรือบิลปิด/ยกเลิกไปแล้ว แก้รายการไม่ได้' }

router.post('/bills/:id/items', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const userId = (req as any).user!.userId
    const { id } = req.params
    const { pos_menu_id, quantity, special_instructions } = req.body
    const numQty = Number(quantity)
    if (!pos_menu_id || !numQty || numQty <= 0 || !Number.isFinite(numQty)) {
      return res.status(400).json({ success: false, message: 'Menu ID and valid positive quantity required' })
    }
    if (!findOpenBill(id, tenantId)) return res.status(409).json(BILL_NOT_OPEN)
    
    // Get menu details (JOIN stock_items to get product_name)
    const menuStmt = db.prepare(`
      SELECT pmc.*, si.name as product_name, si.sku as product_code
      FROM pos_menu_configs pmc
      LEFT JOIN stock_items si ON pmc.product_id = si.id
      WHERE pmc.id = ? AND pmc.tenant_id = ?
    `)
    const menu = menuStmt.get(pos_menu_id, tenantId)

    if (!menu) {
      return res.status(404).json({ success: false, message: 'Menu not found' })
    }

    const rawNote = typeof (special_instructions ?? req.body.notes) === 'string'
      ? (special_instructions ?? req.body.notes).trim()
      : ''
    const noteVal = rawNote || null

    // ponytail: ถ้ามีรายการเมนูเดียวกันที่ยังไม่ส่งครัว (sent_to_kds = 0) และมีหมายเหตุตรงกัน ให้บวกจำนวนแทนการสร้างแถวใหม่
    // ยกเว้นรายการที่เป็นของแถมจากการแลกแต้ม (pos_redemptions) ห้ามนำรายการใหม่มา merge เข้าเด็ดขาด
    const existing = db.prepare(`
      SELECT id, quantity, unit_price FROM pos_bill_items
      WHERE bill_id = ? AND tenant_id = ? AND pos_menu_id = ?
        AND (sent_to_kds = 0 OR sent_to_kds IS NULL)
        AND COALESCE(TRIM(special_instructions), '') = ?
        AND NOT EXISTS (
          SELECT 1 FROM pos_redemptions r
          WHERE r.bill_item_id = pos_bill_items.id AND r.tenant_id = ?
        )
      ORDER BY added_at ASC LIMIT 1
    `).get(id, tenantId, pos_menu_id, rawNote, tenantId) as any

    if (existing) {
      const mergedQty = existing.quantity + numQty
      const mergedTotal = mergedQty * existing.unit_price
      db.prepare(`
        UPDATE pos_bill_items
        SET quantity = ?, total_price = ?
        WHERE id = ? AND bill_id = ? AND tenant_id = ?
      `).run(mergedQty, mergedTotal, existing.id, id, tenantId)

      recalculateBillTotals(id)
      return res.json({
        success: true,
        message: 'Item quantity updated',
        data: { id: existing.id, quantity: mergedQty }
      })
    }

    const itemId = generateId()
    const totalPrice = (menu as any).pos_price * numQty

    const stmt = db.prepare(`
      INSERT INTO pos_bill_items (
        id, tenant_id, bill_id, pos_menu_id, product_name,
        quantity, unit_price, total_price, special_instructions, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      itemId, tenantId, id, pos_menu_id, (menu as any).product_name || (menu as any).product_code || 'Unknown',
      numQty, (menu as any).pos_price, totalPrice, noteVal, userId
    )
    
    // Recalculate bill totals
    recalculateBillTotals(id)
    
    res.json({ 
      success: true, 
      message: 'Item added successfully',
      data: { id: itemId }
    })
  } catch (error) {
    console.error('Error adding item:', error)
    res.status(500).json({ success: false, message: 'Failed to add item' })
  }
})

// Update bill item (quantity, instructions)
router.put('/bills/:billId/items/:itemId', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { billId, itemId } = req.params
    const { quantity } = req.body
    
    if (quantity !== undefined) {
      const numQty = Number(quantity)
      if (!Number.isFinite(numQty) || numQty <= 0) {
        return res.status(400).json({ success: false, message: 'Quantity must be a positive number' })
      }
    }

    if (!findOpenBill(billId, tenantId)) return res.status(409).json(BILL_NOT_OPEN)

    // Get current item scoped to tenant
    const itemStmt = db.prepare(`
      SELECT bi.* FROM pos_bill_items bi
      JOIN pos_running_bills b ON bi.bill_id = b.id
      WHERE bi.id = ? AND bi.bill_id = ? AND b.tenant_id = ?
    `)
    const item = itemStmt.get(itemId, billId, tenantId)
    
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' })
    }

    // ponytail: รายการของแถมจากการแลกแต้ม QR ถูกผูกกับ pos_redemptions ล็อกจำนวนไว้ ห้ามเพิ่ม/ลด (แต้มคิดแค่ครั้งเดียว)
    if (quantity !== undefined && Number(quantity) !== (item as any).quantity) {
      const isReward = db.prepare(`
        SELECT 1 FROM pos_redemptions
        WHERE tenant_id = ? AND bill_id = ? AND bill_item_id = ? AND status = 'RESERVED'
      `).get(tenantId, billId, itemId)

      if (isReward) {
        return res.status(409).json({
          success: false,
          code: 'REWARD_ITEM_LOCKED',
          message: 'รายการของแถมจากการแลกแต้มไม่สามารถแก้ไขจำนวนได้ หากต้องการเปลี่ยนให้ลบรายการออกแล้วสั่งใหม่',
        })
      }
    }
    
    const newQty = quantity || (item as any).quantity
    if (!guardKitchenItemChange(req, res, billId, item, Number(newQty))) return

    const hasInstructionsUpdate = req.body.special_instructions !== undefined || req.body.notes !== undefined
    const finalInstructions = hasInstructionsUpdate
      ? (String(req.body.special_instructions ?? req.body.notes ?? '').trim() || null)
      : (item as any).special_instructions

    // เพิ่มจำนวนของที่ส่งครัวไปแล้ว: ส่วนที่เพิ่มต้องเป็นรายการใหม่ที่ยังไม่ส่ง ไม่งั้นครัวไม่มีวันรู้
    // (ส่งครัวหยิบเฉพาะ sent_to_kds = 0 — เดิมกด + บนรายการเก่าแล้วยอดบิลขึ้น แต่ครัวทำจำนวนเดิม)
    if ((item as any).sent_to_kds && Number(newQty) > (item as any).quantity) {
      const extra = Number(newQty) - (item as any).quantity
      db.prepare(`INSERT INTO pos_bill_items (id, tenant_id, bill_id, pos_menu_id, product_name,
          quantity, unit_price, total_price, special_instructions, created_by)
        SELECT ?, tenant_id, bill_id, pos_menu_id, product_name, ?, unit_price, unit_price * ?, ?, ?
        FROM pos_bill_items WHERE id = ?`).run(generateId(), extra, extra, finalInstructions, (req as any).user!.userId, itemId)
      recalculateBillTotals(billId)
      return res.json({ success: true, message: 'Item updated successfully' })
    }
    const unitPrice = (item as any).unit_price
    const newTotal = newQty * unitPrice

    const stmt = db.prepare(`
      UPDATE pos_bill_items 
      SET quantity = ?, total_price = ?, special_instructions = ?
      WHERE id = ? AND bill_id = ? AND EXISTS (
        SELECT 1 FROM pos_running_bills b WHERE b.id = ? AND b.tenant_id = ?
      )
    `)
    
    stmt.run(newQty, newTotal, finalInstructions, itemId, billId, billId, tenantId)

    // ถ้าออเดอร์ส่งครัวไปแล้ว และมีการแก้หมายเหตุ ให้อัปเดตตั๋วครัวที่ยังทำไม่เสร็จด้วย
    if (hasInstructionsUpdate && (item as any).sent_to_kds) {
      const activeTickets = `SELECT id FROM pos_kds_tickets WHERE tenant_id = ? AND status IN ('PENDING', 'IN_PROGRESS')`
      db.prepare(`
        UPDATE pos_kds_ticket_items
        SET special_instructions = ?
        WHERE bill_item_id = ? AND ticket_id IN (${activeTickets})
      `).run(finalInstructions, itemId, tenantId)
    }
    
    // Recalculate bill totals
    recalculateBillTotals(billId)
    
    res.json({ success: true, message: 'Item updated successfully' })
  } catch (error) {
    console.error('Error updating item:', error)
    res.status(500).json({ success: false, message: 'Failed to update item' })
  }
})

// Delete bill item
router.delete('/bills/:billId/items/:itemId', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { billId, itemId } = req.params
    if (!findOpenBill(billId, tenantId)) return res.status(409).json(BILL_NOT_OPEN)

    const item = db.prepare('SELECT * FROM pos_bill_items WHERE id = ? AND bill_id = ? AND tenant_id = ?').get(itemId, billId, tenantId)
    if (item && !guardKitchenItemChange(req, res, billId, item, 0)) return

    const stmt = db.prepare(`
      DELETE FROM pos_bill_items 
      WHERE id = ? AND bill_id = ? AND EXISTS (
        SELECT 1 FROM pos_running_bills b WHERE b.id = ? AND b.tenant_id = ?
      )
    `)
    const result = stmt.run(itemId, billId, billId, tenantId)
    
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Item not found' })
    }
    
    // Recalculate bill totals
    recalculateBillTotals(billId)
    
    res.json({ success: true, message: 'Item removed successfully' })
  } catch (error) {
    console.error('Error deleting item:', error)
    res.status(500).json({ success: false, message: 'Failed to delete item' })
  }
})

// ==================== PAYMENT & STOCK ====================

class BillAlreadyPaidError extends Error {}

// Process payment (deduct stock + record payment + accounting)
router.post('/bills/:id/pay', async (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const userId = (req as any).user!.userId
    const { id } = req.params
    const { payment_method, received_amount, reference, redeem_points, bank_account_id,
      discount_amount, extra_charge_amount, extra_charge_label } = req.body

    if (!payment_method) {
      return res.status(400).json({ success: false, message: 'Payment method required' })
    }

    const openShift = requireSellableShift(tenantId, res, true)
    if (!openShift) return

    // Get bill with items
    const billStmt = db.prepare(`
      SELECT b.*, COUNT(bi.id) as item_count
      FROM pos_running_bills b
      LEFT JOIN pos_bill_items bi ON b.id = bi.bill_id
      WHERE b.id = ? AND b.tenant_id = ? AND b.status = 'OPEN'
      GROUP BY b.id
    `)
    const bill = billStmt.get(id, tenantId)
    
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found or already paid' })
    }
    
    if ((bill as any).item_count === 0) {
      return res.status(400).json({ success: false, message: 'Cannot pay empty bill' })
    }

    const manualDiscount = Math.max(0, Number(discount_amount) || 0)

    // แลกแต้ม = ส่วนลดท้ายบิล คิดด้วยอัตราของร้านฝั่ง server (เดิมหน้าจอหักเองแต่บิล/บัญชี/VAT บันทึกยอดเต็ม)
    const loyalty = getLoyaltySettings(tenantId)
    const redeemPts = Math.max(0, Math.floor(Number(redeem_points) || 0))
    let redeemBaht = 0
    if (redeemPts > 0) {
      const member = (bill as any).customer_id
        ? db.prepare('SELECT loyalty_points FROM customers WHERE id = ? AND tenant_id = ?').get((bill as any).customer_id, tenantId) as any
        : null
      // สมาชิกที่ลูกค้าผูกเองจากมือถือ (ไม่มี OTP) ต้องให้แคชเชียร์ยืนยันตัวตนก่อนจึงแลกแต้มได้
      const unverified = (bill as any).member_device_id
        && !(db.prepare('SELECT verified_at FROM pos_member_devices WHERE id = ?').get((bill as any).member_device_id) as any)?.verified_at

      const ptsInfo = (bill as any).customer_id ? availablePoints(tenantId, (bill as any).customer_id) : null
      const available = ptsInfo?.available ?? 0
      const reserved = ptsInfo?.reserved ?? 0

      const redeemError = !loyalty.enabled ? 'ร้านปิดระบบแต้มสะสมอยู่'
        : !member ? 'บิลนี้ยังไม่ได้ผูกสมาชิก แลกแต้มไม่ได้'
        : unverified ? 'สมาชิกสมัครผ่าน QR ยังไม่ได้ยืนยันตัวตน — กด "ยืนยันสมาชิก" ที่บิลก่อนแลกแต้ม'
        : redeemPts < loyalty.minRedeem ? `ต้องแลกขั้นต่ำ ${loyalty.minRedeem} แต้ม`
        : redeemPts > available
          ? (reserved > 0
              ? `คะแนนสะสมไม่พอสำหรับการแลก (ใช้ได้ ${available.toLocaleString()} แต้ม, จองไว้กับของแถม ${reserved.toLocaleString()} แต้ม)`
              : 'คะแนนสะสมของลูกค้าไม่เพียงพอสำหรับการแลก')
        : null
      if (redeemError) return res.status(400).json({ success: false, code: 'REDEEM_INVALID', message: redeemError })
      redeemBaht = Math.floor(redeemPts / loyalty.redeemRate)
    }
    const rewardConflict = billRewardConflict(tenantId, id, (bill as any).customer_id || null)
    if (rewardConflict) return res.status(409).json({ success: false, code: 'REWARD_MEMBER_MISMATCH', message: rewardConflict })

    // ส่วนลด/ค่าขนส่งที่แคชเชียร์ใส่หน้าจอต้องลงบิลก่อนคำนวณ ไม่งั้นลูกค้าจ่ายยอดหนึ่ง
    // แต่บัญชี/VAT/ใบกำกับบันทึกอีกยอดหนึ่ง (เดิมสองค่านี้ไม่เคยถูกส่งมาที่ backend เลย)
    // ส่วนลดจากแต้ม (redeemBaht) ยังไม่ลงบิลตรงนี้ — ลงใน payTx ตอนตัดจ่ายจริงเท่านั้น
    // (เดิมลงก่อน แล้วติดด่าน/สต็อก → เปิดบิลใหม่หน้าจอดึงกลับเป็นส่วนลดมือ แลกแต้มซ้ำ = ลดสองต่อ)
    const prevDiscount = Number((bill as any).discount_amount) || 0
    if (discount_amount !== undefined || extra_charge_amount !== undefined) {
      db.prepare(`UPDATE pos_running_bills
        SET discount_amount = ?, extra_charge_amount = ?, extra_charge_label = ?
        WHERE id = ? AND tenant_id = ?`)
        .run(manualDiscount, Math.max(0, Number(extra_charge_amount) || 0),
          extra_charge_label || null, id, tenantId)
    }

    // Ensure bill totals are up-to-date with current POS billing settings
    recalculateBillTotals(id)
    let refreshedBill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?').get(id, tenantId)

    // เกณฑ์อนุมัติส่วนลด:
    // 1) ส่วนลดเกิน % ที่ตั้งไว้ (Settings → การอนุมัติ, ค่าเริ่ม 40%) ของยอดก่อนลด ต้องขออนุมัติเสมอ (ยกเว้น ADMIN/MASTER หรือผู้มีสิทธิ์ bypass)
    // 2) หรือตั้งเพดาน pos_discount ใน Settings → การอนุมัติ
    // ส่วนลดจากการแลกแต้มไม่นับ (ยังไม่อยู่ในบิลตอนนี้) — เป็นสิทธิ์ของสมาชิกตามอัตราที่ร้านตั้ง
    const discountBaht = Math.max(0, Number((refreshedBill as any)?.discount_amount) || 0)
    const baseBeforeDiscount = ((refreshedBill as any)?.subtotal || 0)
      + ((refreshedBill as any)?.service_charge_amount || 0)
      + ((refreshedBill as any)?.extra_charge_amount || 0)
    const discountPct = baseBeforeDiscount > 0 ? Math.round((discountBaht / baseBeforeDiscount) * 1000) / 10 : 0
    const limitPct = posDiscountApprovalPct(tenantId)
    const overLimitPct = discountBaht > 0 && discountPct > limitPct
    const gateUser = (req as any).user

    // เช็คว่าบิลนี้เคยได้รับอนุมัติส่วนลดยอดนี้ไปแล้วหรือยัง — ต้องครอบทั้งบาทและ % (ลบรายการหลังอนุมัติ = % สูงขึ้น ต้องขอใหม่)
    const approvedDiscountReq = discountBaht > 0 ? db.prepare(`
      SELECT id FROM approval_requests
      WHERE tenant_id = ? AND module_type = 'pos_discount'
        AND reference_type = 'pos_running_bills' AND reference_id = ?
        AND status IN ('APPROVED', 'EXECUTED') AND amount >= ?
        AND COALESCE(json_extract(payload, '$.discountPct'), 0) >= ?
      ORDER BY created_at DESC LIMIT 1
    `).get(tenantId, id, discountBaht, discountPct) as any : null

    const needsDiscountApproval = discountBaht > 0
      && !approvedDiscountReq
      && (overLimitPct || isApprovalRequired(tenantId, gateUser, 'pos_discount', discountBaht))
      && !hasBypass(tenantId, gateUser, 'pos_discount')

    if (needsDiscountApproval) {
      // ยังไม่อนุมัติ → คืนส่วนลดบนบิลเป็นค่าเดิม หน้าบิล/QR จะได้ไม่เห็นยอดที่ลดแล้ว (อนุมัติแล้ว executor เขียนให้เอง)
      db.prepare('UPDATE pos_running_bills SET discount_amount = ? WHERE id = ? AND tenant_id = ?').run(prevDiscount, id, tenantId)
      recalculateBillTotals(id)
      // ใช้คำขอที่ค้างอยู่ได้เฉพาะเมื่อครอบยอดและ % นี้ ไม่งั้นอนุมัติแล้วก็ยังจ่ายไม่ผ่าน
      const open = findPendingRequest(tenantId, 'pos_discount', 'pos_running_bills', id)
      const covers = open && open.amount >= discountBaht
        && (Number(JSON.parse(open.payload || '{}').discountPct) || 0) >= discountPct
      const pending = covers ? open : createRequest({
          tenantId,
          user: gateUser,
          category: 'pos_discount',
          refType: 'pos_running_bills',
          refId: id,
          amount: discountBaht,
          description: `บิล ${(refreshedBill as any).bill_number} ขออนุมัติส่วนลด ฿${discountBaht.toLocaleString()} (${discountPct}% ของยอด ฿${baseBeforeDiscount.toLocaleString()})`,
          payload: {
            severity: 'high',
            billId: id,
            discountAmount: discountBaht,
            discountPct,
            baseBeforeDiscount,
          },
        })
      return res.status(202).json({
        success: true,
        pending_approval: true,
        request_number: pending.request_number,
        message: `ส่วนลด ฿${discountBaht.toLocaleString()} (${discountPct}%) เกินเกณฑ์ ${limitPct}% — ส่งคำขออนุมัติ (${pending.request_number}) และแจ้งเตือนผู้อนุมัติแล้ว กรุณารอการอนุมัติก่อนชำระเงิน`,
      })
    }
    
    // 1. Deduct stock using service — ข้ามถ้าบิลนี้เคยตัดสต็อกไปแล้ว (จ่ายรอบก่อนล้มหลังตัดสต็อก)
    // กด/ยิงซ้ำจะได้ไม่ตัดสองรอบ
    // ponytail: deductStockOnPayment เป็น async (มี transaction ของตัวเอง) จึงอยู่นอก transaction
    // การจ่ายด้านล่าง — idempotent ต่อบิลแทน ถ้า service กลายเป็น sync ค่อยย้ายเข้าไปรวม
    const alreadyDeducted = db.prepare(`
      SELECT 1 FROM pos_stock_deductions psd
      JOIN pos_bill_items bi ON bi.id = psd.bill_item_id AND bi.tenant_id = psd.tenant_id
      WHERE bi.bill_id = ? AND psd.tenant_id = ? LIMIT 1
    `).get(id, tenantId)
    const stockResult = alreadyDeducted
      ? { success: true, deductions: [] as any[], errors: [] as string[], issues: undefined as any[] | undefined }
      : await posStockService.deductStockOnPayment(id, tenantId, userId)
    
    if (!stockResult.success) {
      return res.json({ 
        success: true,
        data: {
          canPay: false,
          needsAction: true,
          action: 'FIX_STOCK_ISSUES',
          message: 'ไม่สามารถจ่ายเงินได้ — พบปัญหาสต็อกหรือหน่วย',
          issues: stockResult.issues || stockResult.errors.map((e: string) => ({ type: 'UNKNOWN', message: e })),
          errors: stockResult.errors,
          links: {
            stock: '/stock',
            settings: '/settings/unit-conversions',
          }
        }
      })
    }
    
    // 2–5. Payment + PAID + accounting + loyalty ต้องสำเร็จหรือล้มไปด้วยกัน
    // (recordSale เป็น sync และ throw เมื่อพัง → rollback ทั้งก้อน)
    const paymentId = generateId()

    const payTx = db.transaction(() => {
      // ส่วนลดจากแต้มลงบิลตรงนี้ที่เดียว — ทรานแซกชันล้ม = ไม่ค้างบนบิล
      if (redeemBaht > 0) {
        db.prepare('UPDATE pos_running_bills SET discount_amount = discount_amount + ? WHERE id = ? AND tenant_id = ?').run(redeemBaht, id, tenantId)
        recalculateBillTotals(id)
        refreshedBill = db.prepare('SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?').get(id, tenantId)
      }
      const totalAmount = (refreshedBill as any).total_amount
      const changeAmount = received_amount ? received_amount - totalAmount : 0
      const paymentStmt = db.prepare(`
        INSERT INTO pos_payments (id, tenant_id, bill_id, payment_method, amount, received_amount, change_amount, reference, received_by, bank_account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      paymentStmt.run(
        paymentId, tenantId, id, payment_method, totalAmount,
        received_amount || totalAmount, changeAmount > 0 ? changeAmount : 0,
        reference || null, userId, bank_account_id || null
      )
    
      // 3. Update bill status — ผูกบิลเข้ากะที่รับเงินจริง (บิลที่เปิดค้างจากกะก่อนต้องนับเข้ากะนี้)
      const updated = db.prepare(`
        UPDATE pos_running_bills 
        SET status = 'PAID', closed_at = ?, closed_by = ?, shift_id = ?
        WHERE id = ? AND tenant_id = ? AND status = 'OPEN'
      `).run(now(), userId, openShift.id, id, tenantId)
      if (updated.changes !== 1) throw new BillAlreadyPaidError()
    
      // 4. Record accounting entry
      const payment = { payment_method, amount: totalAmount, bank_account_id: bank_account_id || null }
      const accountingResult = posAccountingService.recordSale(
        refreshedBill as any, payment, tenantId, userId
      )

      // 5. Earn loyalty points (if bill has a CRM customer linked)
      let pointsEarned = 0
      let pointsRedeemed = 0
      if ((refreshedBill as any).customer_id) {
        const customerId = (refreshedBill as any).customer_id
        const customer = db.prepare('SELECT loyalty_points, total_spent FROM customers WHERE id = ? AND tenant_id = ?').get(customerId, tenantId) as any
        if (customer) {
          // อัตราแต้มเป็นของร้าน (Settings → แต้มสะสม เก็บใน company_settings) ไม่รับค่าจาก client
          // เดิมอ่านคอลัมน์ key/value ที่ไม่มีอยู่จริง → บิลที่ผูกสมาชิกทุกใบจ่ายเงินไม่ผ่าน (500)
          pointsEarned = loyalty.enabled ? Math.floor(totalAmount / loyalty.earnRate) : 0

          const balanceBefore = customer.loyalty_points || 0
          // แต้มที่จองไว้กับของแถม (แลกผ่าน QR) ตัดจริงพร้อมแต้มที่แลกที่เคาน์เตอร์
          pointsRedeemed = redeemPts + useBillRewards(tenantId, id)

          if (pointsRedeemed > balanceBefore) {
            const diff = pointsRedeemed - balanceBefore
            throw new InsufficientPointsError(`คะแนนสะสมของลูกค้าไม่เพียงพอสำหรับการแลก (ขาดอีก ${diff} แต้ม)`)
          }

          const balanceAfter = Math.max(0, balanceBefore - pointsRedeemed) + pointsEarned

          db.prepare(`
            UPDATE customers SET loyalty_points = ?, total_spent = ? WHERE id = ? AND tenant_id = ?
          `).run(balanceAfter, (customer.total_spent || 0) + totalAmount, customerId, tenantId)

          // แต้มจาก POS เคยลงตาราง crm_points_transactions ซึ่งไม่มีหน้าไหนอ่านเลยสักที่
          // (write-only 0 แถวในฐานจริง) ส่วนแท็บแต้มสะสมในหน้า CRM อ่าน loyalty_transactions
          // คนละตาราง ผลคือแต้มที่ลูกค้าได้จากการซื้อหน้าร้านไม่เคยโผล่ในประวัติของตัวเอง
          // ย้ายมาเขียนตารางเดียวกับที่ UI อ่าน · ธรรมเนียมของตารางนี้: REDEEM เก็บเป็นเลขติดลบ
          const logPoints = db.prepare(`
            INSERT INTO loyalty_transactions (id, tenant_id, customer_id, type, points, balance_after, reference_type, reference_id, note, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'POS_BILL', ?, ?, ?, ?)
          `)
          const pointsBy = (req.user as any)?.email || userId

          if (pointsRedeemed > 0) {
            logPoints.run(
              generateId(), tenantId, customerId, 'REDEEM',
              -pointsRedeemed, Math.max(0, balanceBefore - pointsRedeemed), id,
              `แลกแต้มลดราคาจากบิล ${(refreshedBill as any).bill_number}`,
              pointsBy, now()
            )
          }

          if (pointsEarned > 0) {
            logPoints.run(
              generateId(), tenantId, customerId, 'EARN',
              pointsEarned, balanceAfter, id,
              `สะสมแต้มจากบิล ${(bill as any).bill_number}`,
              pointsBy, now()
            )
          }
        }
      }
      recordPaidBill(tenantId, id, Boolean((refreshedBill as any).customer_id))
      return { accountingResult, pointsEarned, pointsRedeemed, totalAmount, changeAmount }
    })
    const { accountingResult, pointsEarned, pointsRedeemed, totalAmount, changeAmount } = payTx()

    if (discountBaht > 0 && !approvedDiscountReq) {
      // ส่วนลดเกิน % ที่ตั้งไว้ หรือเกินเพดานของพนักงาน = แดง, ใต้เพดาน = เหลือง
      const cap = db.prepare(`SELECT approval_required, auto_approve_threshold FROM approval_settings
        WHERE tenant_id = ? AND role = 'USER' AND module_type = 'pos_discount'`).get(tenantId) as any
      const overCap = overLimitPct || (cap?.approval_required === 1 && discountBaht > (cap.auto_approve_threshold || 0))
      recordAutoAction({
        tenantId, user: gateUser, category: 'pos_discount', refType: 'pos_running_bills', refId: id,
        amount: discountBaht,
        description: `บิล ${(refreshedBill as any).bill_number} ให้ส่วนลด ฿${discountBaht.toLocaleString()} (${discountPct}%) จากยอด ฿${baseBeforeDiscount.toLocaleString()}`,
        payload: { severity: overCap ? 'high' : 'low', billId: id, discountPct },
      })
    }

    res.json({
      success: true,
      message: 'Payment processed successfully',
      data: {
        payment_id: paymentId,
        amount: totalAmount,
        change: changeAmount > 0 ? changeAmount : 0,
        stock_deductions: stockResult.deductions.length,
        journal_entry_id: accountingResult.journalEntryId,
        points_earned: pointsEarned,
        points_redeemed: pointsRedeemed,
        redeem_discount: redeemBaht,
      }
    })
  } catch (error: any) {
    if (error instanceof BillAlreadyPaidError) {
      return res.status(409).json({ success: false, message: 'บิลนี้ถูกชำระ/ปิดไปแล้ว' })
    }
    if (error instanceof InsufficientPointsError) {
      return res.status(400).json({ success: false, code: error.code || 'REDEEM_INVALID', message: error.message })
    }
    console.error('Error processing payment:', error)
    res.status(500).json({ success: false, message: 'Failed to process payment' })
  }
})

// Cancel bill (return stock + record accounting)
router.post('/bills/:id/cancel', async (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const userId = (req as any).user!.userId
    const { id } = req.params
    const { reason } = req.body
    
    // Get bill
    const billStmt = db.prepare('SELECT * FROM pos_running_bills WHERE id = ? AND tenant_id = ?')
    const bill = billStmt.get(id, tenantId)
    
    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' })
    }
    
    if ((bill as any).status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Bill already cancelled' })
    }

    // Clearing Guard: บิลที่ส่งยอดเข้าธนาคาร/Clearing ไปแล้ว ห้ามยกเลิกโดยเด็ดขาด
    const cleared = db.prepare(`
      SELECT 1 FROM pos_clearing_transfer_items ti
      JOIN pos_clearing_transfers t ON ti.transfer_id = t.id
      WHERE ti.bill_id = ? AND t.tenant_id = ?
    `).get(id, tenantId)
    if (cleared) {
      return res.status(400).json({ success: false, message: 'บิลนี้ถูกนำส่งยอดเคลียริ่งเข้าธนาคารแล้ว ไม่สามารถยกเลิกได้' })
    }

    // Invoice Guard: บิลที่ออกใบกำกับภาษีแล้ว ต้องยกเลิกหรือออกใบลดหนี้ผ่านระบบภาษีก่อน
    const invoice = db.prepare(`
      SELECT id, invoice_number FROM invoices WHERE pos_bill_id = ? AND tenant_id = ? AND status != 'CANCELLED'
    `).get(id, tenantId) as any
    if (invoice) {
      return res.status(400).json({ success: false, message: `บิลนี้ออกใบกำกับภาษีแล้ว (${invoice.invoice_number}) ต้องยกเลิกหรือออกใบลดหนี้ผ่านระบบภาษีก่อน` })
    }

    // ประตูอนุมัติ: หมวด "ปิดบิล POS / คืนเงิน"
    const gateArgs = {
      tenantId,
      user: (req as any).user,
      category: 'pos_void' as const,
      refType: 'pos_running_bills',
      refId: id,
      amount: (bill as any).total_amount || 0,
      description: `บิล ${(bill as any).bill_number} ยอด ฿${((bill as any).total_amount || 0).toLocaleString()} ขอยกเลิก${reason ? ` เนื่องจาก ${reason}` : ''}`,
      // บิลที่รับเงินแล้วถูกยกเลิก = เงินถอยออก (แดง) · บิลยังไม่จ่าย = ส้ม
      payload: { billId: id, reason, finalStatus: 'CANCELLED', severity: (bill as any).status === 'PAID' ? 'high' : 'medium' },
    }
    const pending = gateOrCreate(gateArgs)
    if (pending) {
      return res.status(202).json({
        success: true,
        pending_approval: true,
        request_number: pending.request_number,
        message: `ส่งคำขออนุมัติแล้ว (${pending.request_number}) บิลจะถูกยกเลิกเมื่อผู้อนุมัติยืนยัน`,
      })
    }

    const { stockResult, accountingResult } = await cancelPosBill(tenantId, userId, id, reason, 'CANCELLED')
    recordAutoAction(gateArgs)
    res.json({ 
      success: true, 
      message: 'Bill cancelled successfully',
      data: {
        stock_returns: stockResult.returns.length,
        journal_entry_id: accountingResult.journalEntryId
      }
    })
  } catch (error) {
    console.error('Error cancelling bill:', error)
    res.status(500).json({ success: false, message: 'Failed to cancel bill' })
  }
})

// Map SalesBillingError codes → HTTP status สำหรับออกใบกำกับจากบิล POS
// (แพทเทิร์นเดียวกับ INVOICE_ERROR_STATUS ใน routes/sales/invoices.ts)
const POS_INVOICE_ERROR_STATUS: Record<string, number> = {
  DUPLICATE_INVOICE: 409,
  POS_BILL_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  POS_BILL_NOT_PAID: 400,
  POS_BILL_CANCELLED: 400,
  CUSTOMER_REQUIRED: 400,
}

// ยืนยันออกใบกำกับภาษีจากบิล POS ที่ชำระเงินแล้ว
// ⚠️ ห้ามผ่าน gateOrCreate/ประตูอนุมัติที่นี่ (ต่างจาก /cancel ข้างบน) — executeApprovedAction
// ใน approval.routes.ts ยังไม่มี handler ของหมวด pos_invoice เลย ถ้า gate คืน 202 คำขอจะค้าง
// อยู่ใน inbox ตลอดไปไม่มีใครรันให้ ต้องเพิ่ม handler ที่นั่นก่อนถึงจะเอา gate มาครอบตรงนี้ได้
router.post('/bills/:id/invoice', (req, res) => {
  try {
    if (!canHandleBilling((req as any).user!, 'sales')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ทำรายการนี้ — ต้องอยู่ฝ่ายขาย/ฝ่ายบัญชี หรือเป็น ADMIN/MASTER' })
    }
    const tenantId = (req as any).user!.tenantId
    const { id } = req.params
    const { customerId, notes } = req.body

    // ตรรกะจริงอยู่ที่ services/salesBilling.service.ts createInvoiceFromPosBill — วางไว้ที่ service
    // เพื่อให้สาย MCP มาเรียกตัวเดียวกันได้เมื่อถึงเวลา (วันนี้ MCP ยังไม่มี tool ออกใบแจ้งหนี้เลย)
    // ไม่ลง journal/vat_entries/สต็อกซ้ำ — ลงไปแล้วตอนปิดบิล POS
    const { invoice, items } = createInvoiceFromPosBill(tenantId, { posBillId: id, customerId, notes })

    res.status(201).json({ success: true, message: 'ออกใบกำกับภาษีสำเร็จ', data: { invoice, items } })
  } catch (error) {
    if (error instanceof SalesBillingError) {
      return res.status(POS_INVOICE_ERROR_STATUS[error.code] || 400).json({ success: false, message: error.message })
    }
    console.error('Error creating invoice from POS bill:', error)
    res.status(500).json({ success: false, message: 'Failed to create invoice' })
  }
})

// ==================== GS1 BARCODE SEARCH ====================

// Search menu by GS1 barcode
router.get('/search/gs1/:barcode', (req, res) => {
  try {
    const tenantId = (req as any).user!.tenantId
    const { barcode } = req.params
    
    // Find stock item by GS1 barcode
    const stockItem = db.prepare(`
      SELECT * FROM stock_items 
      WHERE gs1_barcode = ? AND tenant_id = ? AND is_pos_enabled = 1
    `).get(barcode, tenantId) as any
    
    if (!stockItem) {
      return res.status(404).json({ 
        success: false, 
        message: 'ไม่พบสินค้าสำหรับ barcode นี้' 
      })
    }
    
    // เมนู POS ผูกกับ stock_items ตรง ๆ (pmc.product_id = stock_items.id)
    // ของเดิมวิ่งผ่านตาราง products ที่เลิกใช้แล้ว (หา code = stockItem.sku) ทำให้ตอบ
    // "ไม่พบสินค้าในระบบ" ทุกครั้ง ทั้งที่สินค้ามีอยู่จริง
    const menuConfig = db.prepare(`
      SELECT
        pmc.*,
        si.name as product_name,
        si.sku as product_code,
        pc.name as category_name,
        pc.color as category_color
      FROM pos_menu_configs pmc
      JOIN stock_items si ON pmc.product_id = si.id AND si.tenant_id = pmc.tenant_id
      LEFT JOIN pos_categories pc ON pmc.category_id = pc.id
      WHERE pmc.product_id = ?
        AND pmc.tenant_id = ?
        AND pmc.is_available = 1
        AND pmc.is_pos_enabled = 1
    `).get(stockItem.id, tenantId) as any
    
    if (!menuConfig) {
      return res.status(404).json({ 
        success: false, 
        message: 'สินค้านี้ไม่ได้เปิดใช้งานใน POS' 
      })
    }
    
    res.json({
      success: true,
      data: {
        id: menuConfig.id,
        product_id: menuConfig.product_id,
        product_name: menuConfig.product_name,
        product_code: menuConfig.product_code,
        category_id: menuConfig.category_id,
        category_name: menuConfig.category_name,
        category_color: menuConfig.category_color,
        pos_price: menuConfig.pos_price,
        gs1_barcode: stockItem.gs1_barcode,
        stock_item: {
          id: stockItem.id,
          sku: stockItem.sku,
          name: stockItem.name,
          quantity: stockItem.quantity,
          unit: stockItem.unit
        }
      }
    })
  } catch (error) {
    console.error('Error searching by GS1 barcode:', error)
    res.status(500).json({ success: false, message: 'Failed to search by barcode' })
  }
})

// ==================== HELPERS ====================

export function recalculateBillTotals(billId: string) {
  // Get all items
  const itemsStmt = db.prepare('SELECT * FROM pos_bill_items WHERE bill_id = ?')
  const items = itemsStmt.all(billId)
  
  let subtotal = (items as any[]).reduce((sum, item) => sum + item.total_price, 0)
  
  // Get bill tenant to lookup company POS billing settings
  const billRow = db.prepare('SELECT tenant_id, discount_amount, extra_charge_amount FROM pos_running_bills WHERE id = ?').get(billId) as any
  const tenantId = billRow?.tenant_id
  
  // Read POS billing settings from company_settings (fallback to legacy hardcoded values for backward compat)
  let vatEnabled = true
  let vatRate = 7
  let vatInclusive = false
  let serviceEnabled = true
  let serviceRate = 10
  
  if (tenantId) {
    const settings = db.prepare(`
      SELECT pos_vat_enabled, pos_vat_rate, pos_vat_inclusive, pos_service_enabled, pos_service_rate, tax_id
      FROM company_settings 
      WHERE tenant_id = ?
    `).get(tenantId) as any
    
    // ยังไม่มีเลขผู้เสียภาษี = ยังไม่จด VAT → เก็บภาษีจากลูกค้าไม่ได้ตามกฎหมาย
    // ไม่ว่าสวิตช์จะเปิดค้างไว้ หรือยังไม่เคยตั้งค่าบริษัทเลยก็ตาม
    if (!String(settings?.tax_id || '').trim()) vatEnabled = false

    if (settings && settings.pos_vat_enabled !== null) {
      vatEnabled = vatEnabled && settings.pos_vat_enabled === 1
      vatRate = settings.pos_vat_rate ?? 7
      vatInclusive = settings.pos_vat_inclusive === 1
      serviceEnabled = settings.pos_service_enabled === 1
      serviceRate = settings.pos_service_rate ?? 10
    }
  }
  
  // ต้องตรงกับ calcPosTotals ใน frontend/src/utils/posVat.ts เป๊ะ ๆ ไม่งั้นยอดหน้าจอกับยอดที่บันทึกคนละตัว
  const t = calcPosTotals(subtotal, { vatEnabled, vatRate, vatInclusive, serviceEnabled, serviceRate },
    { discount: billRow?.discount_amount || 0, extraCharge: billRow?.extra_charge_amount || 0 })
  const { serviceChargeAmount, taxAmount, totalAmount } = t
  subtotal = t.subtotal
  
  const updateStmt = db.prepare(`
    UPDATE pos_running_bills 
    SET subtotal = ?, service_charge_amount = ?, service_charge_rate = ?,
        tax_amount = ?, tax_rate = ?, discount_amount = ?, total_amount = ?
    WHERE id = ?
  `)
  updateStmt.run(subtotal, serviceChargeAmount, serviceRate, taxAmount, vatRate, t.discount, totalAmount, billId)
}

export default router
