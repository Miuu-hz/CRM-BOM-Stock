import { Router, Request, Response } from 'express'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import { deductStockForSO, soStockAlreadyDeducted } from './sales/shared'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'
import { approvalDenyReason, canApprove as canApproveRequests, gmActsOn, isGm } from '../services/approvalGate.service'
import { applyStockMovement, applyManualUnpack, StockMovementError } from '../services/stockMovement.service'
import { cancelPosBill } from '../services/posBillCancel.service'
import { recalculateBillTotals } from './pos-bill.routes'
import { applyPurchaseOrderUpdate, PurchaseOrderUpdateError } from '../services/purchaseOrderUpdate.service'
import { PurchaseCancelError } from '../services/purchaseCancel.service'
import { cancelGoodsReceiptNow, cancelPurchaseInvoiceNow, voidSupplierPaymentNow, cancelPurchaseReturnNow } from './purchase.routes'
import { cancelPurchaseOrderNow } from './purchaseOrder.routes'
import { cancelSalesOrderNow, cancelInvoiceNow, voidReceiptNow, SalesCancelError } from '../services/salesCancel.service'
import { cancelCreditNoteNow } from './sales/creditNotes'
import { postCloseRecords, revertCloseApproval } from '../services/closeAdjustments.service'
import { MonthCloseError } from '../services/monthClose.service'

const router = Router()

router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

// ============================================
// APPROVAL SETTINGS (Master ID only)
// ============================================

// GET all approval settings
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const settings = db.prepare(`
      SELECT * FROM approval_settings 
      WHERE tenant_id = ?
      ORDER BY module_type, role
    `).all(tenantId)

    res.json({ success: true, data: settings })
  } catch (error) {
    console.error('Get approval settings error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch settings' })
  }
})

// โมดูลที่ตัวบังคับจริง (approvalGate.service GateCategory + approvalDenyReason) เช็คอยู่เท่านั้น —
// กันแอดมินตั้งค่าหมวดที่ไม่มีใครบังคับ (เช่น work_orders เดิม) แล้วหลงคิดว่าใช้งานได้จริง
const ENFORCED_MODULE_TYPES = new Set([
  'purchase_request', 'purchase_order', 'sales_order', 'stock_adjust', 'pos_void', 'pos_discount', 'doc_edit', 'pos_invoice',
])

// POST create/update approval setting (Master only)
router.post('/settings', requireRole('MASTER', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { role, moduleType, approvalRequired, autoApproveThreshold, maxDiscountPct } = req.body

    if (!role || !moduleType) {
      return res.status(400).json({ success: false, message: 'Role and module type are required' })
    }
    if (!ENFORCED_MODULE_TYPES.has(moduleType)) {
      return res.status(400).json({ success: false, message: `Module type "${moduleType}" is not enforced by any gate` })
    }
    // % ส่วนลด POS ที่ต้องขออนุมัติ — ไม่ส่งมา = คงค่าเดิม
    const pct = maxDiscountPct === undefined || maxDiscountPct === null ? null : Number(maxDiscountPct)
    if (pct !== null && !(pct >= 0 && pct <= 100)) {
      return res.status(400).json({ success: false, message: 'เปอร์เซ็นต์ส่วนลดต้องอยู่ระหว่าง 0–100' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    // Upsert (insert or replace)
    db.prepare(`
      INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold, max_discount_pct, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, role, module_type) DO UPDATE SET
        approval_required = excluded.approval_required,
        auto_approve_threshold = excluded.auto_approve_threshold,
        max_discount_pct = COALESCE(excluded.max_discount_pct, approval_settings.max_discount_pct),
        updated_at = excluded.updated_at
    `).run(id, tenantId, role, moduleType, approvalRequired ? 1 : 0, autoApproveThreshold || 0, pct,
      req.user!.userId, now, now)

    const setting = db.prepare('SELECT * FROM approval_settings WHERE tenant_id = ? AND role = ? AND module_type = ?')
      .get(tenantId, role, moduleType)

    res.json({ success: true, data: setting, message: 'Approval setting saved' })
  } catch (error) {
    console.error('Save approval setting error:', error)
    res.status(500).json({ success: false, message: 'Failed to save setting' })
  }
})

// DELETE approval setting (Master only)
router.delete('/settings/:id', requireRole('MASTER', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    db.prepare('DELETE FROM approval_settings WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    res.json({ success: true, message: 'Approval setting deleted' })
  } catch (error) {
    console.error('Delete approval setting error:', error)
    res.status(500).json({ success: false, message: 'Failed to delete setting' })
  }
})

// ============================================
// USER APPROVAL PERMISSIONS (Master only)
// ============================================

// GET all user permissions
router.get('/permissions', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const permissions = db.prepare(`
      SELECT up.*, u.name as user_name, u.email as user_email
      FROM user_approval_permissions up
      LEFT JOIN users u ON up.user_id = u.id
      WHERE up.tenant_id = ?
      ORDER BY up.module_type, u.name
    `).all(tenantId)

    res.json({ success: true, data: permissions })
  } catch (error) {
    console.error('Get approval permissions error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch permissions' })
  }
})

// POST grant approval permission (Master only)
router.post('/permissions', requireRole('MASTER', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { userId, moduleType, canApprove, canApproveUnlimited, approvalLimit, isMasterApprover, canBypass } = req.body

    if (!userId || !moduleType) {
      return res.status(400).json({ success: false, message: 'User ID and module type are required' })
    }

    // userId มาจาก body ตรงๆ — ไม่เช็คมาก่อนจะมอบสิทธิ์อนุมัติให้ user tenant อื่นได้
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId)
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_approve, can_approve_unlimited, approval_limit, is_master_approver, can_bypass, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, user_id, module_type) DO UPDATE SET
        can_approve = excluded.can_approve,
        can_approve_unlimited = excluded.can_approve_unlimited,
        approval_limit = excluded.approval_limit,
        is_master_approver = excluded.is_master_approver,
        can_bypass = excluded.can_bypass,
        updated_at = excluded.updated_at
    `).run(id, tenantId, userId, moduleType, canApprove ? 1 : 0, canApproveUnlimited ? 1 : 0,
      approvalLimit || 0, isMasterApprover ? 1 : 0, canBypass ? 1 : 0, req.user!.userId, now, now)

    const permission = db.prepare('SELECT * FROM user_approval_permissions WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    res.json({ success: true, data: permission, message: 'Permission granted' })
  } catch (error) {
    console.error('Grant permission error:', error)
    res.status(500).json({ success: false, message: 'Failed to grant permission' })
  }
})

// DELETE permission (Master only)
router.delete('/permissions/:id', requireRole('MASTER', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    db.prepare('DELETE FROM user_approval_permissions WHERE id = ? AND tenant_id = ?').run(req.params.id, tenantId)
    res.json({ success: true, message: 'Permission revoked' })
  } catch (error) {
    console.error('Revoke permission error:', error)
    res.status(500).json({ success: false, message: 'Failed to revoke permission' })
  }
})

// ============================================
// CHECK APPROVAL REQUIRED
// ============================================

// GET check if approval required for user action
router.get('/check-required', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { moduleType, amount } = req.query
    
    if (!moduleType) {
      return res.status(400).json({ success: false, message: 'Module type is required' })
    }

    // Check if approval required for this role
    const setting = db.prepare(`
      SELECT * FROM approval_settings 
      WHERE tenant_id = ? AND role = ? AND module_type = ?
    `).get(tenantId, req.user!.role, moduleType) as any

    // ถามตัวบังคับจริงตัวเดียวกับที่ใช้ตอนกดส่ง — ห้ามคิดกฎเองซ้ำ
    // เดิมตรงนี้ตอบว่า "ไม่ต้องขออนุมัติ" เมื่อไม่มีแถวใน approval_settings
    // แต่ approvalDenyReason ปฏิเสธในกรณีเดียวกัน → หน้าเว็บโชว์ปุ่มให้กดแล้วกดไม่ผ่าน
    const amtNow = parseFloat(amount as string) || 0
    const gateModule = moduleType === 'purchase_order' ? 'purchase_order' : 'purchase_request'
    const denied = approvalDenyReason(tenantId, req.user!, gateModule as any, amtNow, 'PR')

    if (!setting) {
      return res.json({
        success: true,
        data: {
          required: !!denied,
          reason: denied || 'อยู่ในสิทธิ์ที่ทำเองได้',
          selfApproveAllowed: !denied,
          autoApproveThreshold: 0,
        },
      })
    }

    // Check auto approve threshold
    const amt = parseFloat(amount as string) || 0
    if (setting.auto_approve_threshold > 0 && amt <= setting.auto_approve_threshold) {
      return res.json({
        success: true,
        data: {
          required: false,
          reason: `Amount ${amt} is within auto-approve threshold (${setting.auto_approve_threshold})`,
          autoApproveThreshold: setting.auto_approve_threshold
        }
      })
    }

    // Check if user has permission to bypass (Master approver)
    const userPerm = db.prepare(`
      SELECT * FROM user_approval_permissions
      WHERE tenant_id = ? AND user_id = ? AND module_type = ?
    `).get(tenantId, req.user!.userId, moduleType) as any

    const isMasterApprover = userPerm?.is_master_approver === 1
    const withinLimit = userPerm?.can_approve_unlimited === 1 || 
                       (userPerm?.approval_limit > 0 && amt <= userPerm?.approval_limit)

    res.json({
      success: true,
      data: {
        required: setting.approval_required === 1,
        // คำตัดสินจากตัวบังคับจริง — หน้าเว็บใช้ตัวนี้ตัดสินว่าจะเปิดปุ่ม "ส่งและอนุมัติเลย" ไหม
        selfApproveAllowed: !denied,
        denyReason: denied || null,
        autoApproveThreshold: setting.auto_approve_threshold,
        userCanApprove: userPerm?.can_approve === 1,
        userIsMasterApprover: isMasterApprover,
        userWithinLimit: withinLimit,
        userApprovalLimit: userPerm?.approval_limit || 0
      }
    })
  } catch (error) {
    console.error('Check approval required error:', error)
    res.status(500).json({ success: false, message: 'Failed to check approval requirement' })
  }
})

// ============================================
// APPROVAL REQUESTS
// ============================================

// GET my pending approvals (for approvers)
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    
    // ADMIN/MASTER อนุมัติได้ทุกหมวดโดยไม่ต้องมีแถวใน user_approval_permissions
    // (ตารางนั้นว่างเปล่าทุก tenant — เดิมเจ้าของบริษัทจึงไม่เคยเห็นคำขอสักใบ)
    const isBlanketApprover = req.user!.role === 'ADMIN' || req.user!.role === 'MASTER'

    const userPerms = isBlanketApprover ? [] : db.prepare(`
      SELECT module_type FROM user_approval_permissions
      WHERE tenant_id = ? AND user_id = ? AND can_approve = 1
    `).all(tenantId, userId) as any[]

    const moduleTypes = userPerms.map((p: any) => p.module_type)
    // GM (แผนก CEO) อนุมัติหมวดยกเลิกเอกสารได้โดยไม่ต้องมอบสิทธิ์ — ต้องเห็นคำขอในกล่องด้วย
    if (!isBlanketApprover && isGm(req.user! as any)) moduleTypes.push('sales_cancel', 'purchase_cancel')

    if (!isBlanketApprover && moduleTypes.length === 0) {
      return res.json({ success: true, data: [] })
    }

    // Get pending requests for these modules
    const placeholders = moduleTypes.map(() => '?').join(',')
    const requests = db.prepare(`
      SELECT ar.*, 
        CASE ar.reference_type
          WHEN 'work_orders' THEN (SELECT wo_number FROM work_orders WHERE id = ar.reference_id)
          WHEN 'supplier_payments' THEN (SELECT payment_number FROM supplier_payments WHERE id = ar.reference_id)
          WHEN 'receipts' THEN (SELECT receipt_number FROM receipts WHERE id = ar.reference_id)
          ELSE ar.reference_id
        END as reference_number
      FROM approval_requests ar
      WHERE ar.tenant_id = ?
        ${isBlanketApprover ? '' : `AND ar.module_type IN (${placeholders})`}
        AND ar.status = 'PENDING'
      ORDER BY ar.created_at DESC
    `).all(tenantId, ...(isBlanketApprover ? [] : moduleTypes))

    res.json({ success: true, data: requests })
  } catch (error) {
    console.error('Get pending approvals error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pending approvals' })
  }
})

// GET my requests (for requesters)
router.get('/my-requests', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    
    const requests = db.prepare(`
      SELECT * FROM approval_requests
      WHERE tenant_id = ? AND requester_id = ?
      ORDER BY created_at DESC
    `).all(tenantId, userId)

    res.json({ success: true, data: requests })
  } catch (error) {
    console.error('Get my requests error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch my requests' })
  }
})

// GET ประวัติ/log การอนุมัติทั้งหมด (รวม AUTO) — ใช้ทำหน้า activity log
// ADMIN/MASTER เห็นทั้ง tenant, คนอื่นเห็นแค่คำขอของตัวเอง
router.get('/history', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const isPrivileged = req.user!.role === 'ADMIN' || req.user!.role === 'MASTER'
    const { from, to, moduleType, status, requesterId } = req.query as Record<string, string | undefined>
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
    const offset = parseInt(req.query.offset as string) || 0

    const where: string[] = ['ar.tenant_id = ?']
    const params: any[] = [tenantId]
    if (!isPrivileged) { where.push('ar.requester_id = ?'); params.push(req.user!.userId) }
    if (from) { where.push('ar.created_at >= ?'); params.push(from) }
    if (to) { where.push('ar.created_at <= ?'); params.push(to) }
    if (status) { where.push('ar.status = ?'); params.push(status) }
    if (requesterId) { where.push('ar.requester_id = ?'); params.push(requesterId) }
    // จำนวนต่อหมวดในช่วงเดียวกัน (ไม่กรองหมวด) — ทำชิปหมวดในหน้าบันทึกความเคลื่อนไหว
    const counts = db.prepare(`SELECT ar.module_type, COUNT(*) n FROM approval_requests ar
      WHERE ${where.join(' AND ')} GROUP BY ar.module_type`).all(...params)
    if (moduleType) { where.push('ar.module_type = ?'); params.push(moduleType) }
    const whereSql = where.join(' AND ')

    const total = (db.prepare(`SELECT COUNT(*) c FROM approval_requests ar WHERE ${whereSql}`).get(...params) as any).c

    const data = db.prepare(`
      SELECT ar.id, ar.request_number, ar.module_type, ar.reference_type, ar.reference_id,
        ar.requester_id, ar.requester_name, ar.requester_role, ar.amount, ar.description, ar.status,
        ar.created_at, ar.updated_at, CASE WHEN json_valid(ar.payload) THEN json_extract(ar.payload, '$.severity') END as severity,
        COALESCE(ar.approver_2_name, ar.approver_1_name, ar.final_executor_name) as approver_name,
        COALESCE(ar.approver_2_at, ar.approver_1_at, ar.executed_at) as decided_at,
        COALESCE(ar.approver_2_comment, ar.approver_1_comment, '') as comment
      FROM approval_requests ar
      WHERE ${whereSql}
      ORDER BY ar.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)

    res.json({ success: true, data, total, limit, offset, counts })
  } catch (error) {
    console.error('Get approval history error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch history' })
  }
})

// GET รายละเอียดคำขอเดียว พร้อม payload/before ที่แกะ JSON ให้แล้ว — ใช้ทำหน้า diff ก่อน/หลัง
router.get('/requests/:id/detail', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const isPrivileged = ['ADMIN', 'MASTER', 'OWNER', 'MANAGER'].includes(req.user!.role)

    const request = db.prepare('SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ?')
      .get(req.params.id, tenantId) as any
    if (!request) {
      return res.status(404).json({ success: false, message: 'Approval request not found' })
    }

    const canUserApprove = isPrivileged || canApproveRequests(tenantId, req.user! as any, request.module_type, Number(request.amount) || 0)
    if (!canUserApprove && request.requester_id !== req.user!.userId) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ดูคำขอนี้' })
    }

    // doc_edit เก็บ payload เป็น { before, update } เพื่อให้ผู้อนุมัติเทียบก่อน/หลังได้
    // หมวดอื่น (stock_adjust/pos_void) payload คือ args ของ action ล้วนๆ ไม่มี before
    let payload: any = null
    let before: any = null
    if (request.payload) {
      const stored = JSON.parse(request.payload)
      if (stored && typeof stored === 'object' && 'update' in stored && 'before' in stored) {
        payload = stored.update
        before = stored.before
      } else {
        payload = stored
      }
    }

    res.json({ success: true, data: { ...request, payload, before } })
  } catch (error) {
    console.error('Get approval detail error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch request detail' })
  }
})

// PUT approve/reject request
router.put('/requests/:id/decision', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { decision, comment } = req.body  // decision: APPROVED/REJECTED
    
    if (!decision || !['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be APPROVED or REJECTED' })
    }

    const request = db.prepare('SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ?')
      .get(req.params.id, tenantId) as any

    if (!request) {
      return res.status(404).json({ success: false, message: 'Approval request not found' })
    }

    if (request.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Request is already ${request.status}` })
    }

    const isAdminOrMaster = ['ADMIN', 'MASTER', 'OWNER'].includes(req.user!.role)

    // Self-Approval Guard: Admin/Master ทำเองได้หมด ส่วน role อื่นห้ามอนุมัติคำขอของตัวเอง
    if (!isAdminOrMaster && request.requester_id === req.user!.userId) {
      return res.status(403).json({ success: false, message: 'ไม่สามารถอนุมัติคำขอของตนเองได้ (ต้องให้ผู้อนุมัติท่านอื่นเป็นผู้พิจารณา)' })
    }

    const requestAmount = Number(request.amount) || 0

    // Privilege Escalation Guard: Non-admin จำกัดวงเงินไม่เกิน 5,000 บาท
    if (!isAdminOrMaster && requestAmount > 5000 && !gmActsOn(req.user! as any, request.module_type)) {
      return res.status(403).json({ success: false, message: 'วงเงินคำขอเกินสิทธิ์การอนุมัติ (จำกัดไม่เกิน 5,000 บาท ต้องให้ Admin หรือ Owner อนุมัติ)' })
    }

    // ADMIN/MASTER อนุมัติได้เสมอ นอกนั้นต้องถูกมอบสิทธิ์รายคน
    if (!canApproveRequests(tenantId, req.user! as any, request.module_type, requestAmount)) {
      return res.status(403).json({ success: false, message: 'คุณไม่มีสิทธิ์อนุมัติรายการนี้' })
    }

    const now = new Date().toISOString()

    // ยกเลิกบิล POS ต้องเรียก service แบบ async จึงทำก่อนเปิดทรานแซกชัน
    let claimedStatus = 'PENDING'
    if (decision === 'APPROVED' && request.reference_type === 'pos_running_bills' && request.module_type === 'pos_void') {
      const posPayload = request.payload ? JSON.parse(request.payload) : null
      if (posPayload) {
        // ออกใบกำกับเต็มรูประหว่างรออนุมัติ → ห้าม void (เหมือนด่านใน pos.routes.ts) คำขอยัง PENDING
        const invoice = db.prepare(`SELECT invoice_number FROM invoices WHERE pos_bill_id = ? AND tenant_id = ? AND status != 'CANCELLED'`)
          .get(posPayload.billId, tenantId) as any
        if (invoice) {
          return res.status(409).json({ success: false, message: `อนุมัติไม่สำเร็จ: บิลนี้ออกใบกำกับภาษีแล้ว (${invoice.invoice_number}) ต้องยกเลิกใบกำกับภาษีก่อน` })
        }
        // จองคำขอก่อนยกเลิกบิล — ผู้อนุมัติสองคนกดพร้อมกัน ต้องยกเลิกได้ครั้งเดียว
        const claim = db.prepare(`UPDATE approval_requests SET status = 'PROCESSING' WHERE id = ? AND tenant_id = ? AND status = 'PENDING'`)
          .run(req.params.id, tenantId)
        if (claim.changes === 0) {
          return res.status(409).json({ success: false, message: 'คำขอนี้ได้รับการตัดสินไปแล้วหรือไม่อยู่ในสถานะ PENDING' })
        }
        claimedStatus = 'PROCESSING'
        try {
          await cancelPosBill(tenantId, request.requester_id, posPayload.billId,
            posPayload.reason, posPayload.finalStatus)
        } catch (e) {
          db.prepare(`UPDATE approval_requests SET status = 'PENDING' WHERE id = ? AND status = 'PROCESSING'`).run(req.params.id)
          throw e
        }
      }
    }

    const transaction = db.transaction(() => {
      // Atomic status update with status = 'PENDING' to prevent double-approval race conditions
      const updateResult = db.prepare(`
        UPDATE approval_requests SET
          approver_2_id = ?, approver_2_name = ?, approver_2_decision = ?, approver_2_comment = ?, approver_2_at = ?,
          status = ?,
          updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = ?
      `).run(req.user!.userId, req.user!.email, decision, comment || '', now, decision, now, req.params.id, tenantId, claimedStatus)

      if (updateResult.changes === 0) {
        throw new Error('คำขอนี้ได้รับการตัดสินไปแล้วหรือไม่อยู่ในสถานะ PENDING')
      }

      // Log
      db.prepare(`
        INSERT INTO approval_logs (id, tenant_id, approval_request_id, action, actor_id, actor_name, actor_role,
          comment, old_status, new_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
      `).run(generateId(), tenantId, req.params.id, decision, req.user!.userId, req.user!.email,
        req.user!.role, comment || '', decision, now)

      if (decision === 'APPROVED') {
        executeApprovedAction(request, req.user!.userId, req.user!.email, now)
      } else {
        revertReferenceStatus(request)
      }
    })

    transaction()

    try {
      const { lineBotService } = require('../services/line-bot.service')
      lineBotService.notifyApprovalDecision(
        tenantId,
        request,
        decision,
        req.user!.email || req.user!.userId,
        comment
      ).catch((err: any) => console.error('[approval.routes] notifyApprovalDecision error:', err))
    } catch (e) {}

    const updated = db.prepare('SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: updated, message: `Request ${decision.toLowerCase()}` })
  } catch (error) {
    if (error instanceof SalesCancelError || error instanceof PurchaseCancelError || error instanceof PurchaseOrderUpdateError) {
      // ทรานแซกชัน rollback แล้ว คำขอยัง PENDING — ผู้อนุมัติเห็นเหตุผลแล้วปฏิเสธ/แก้ต้นเหตุได้
      return res.status((error as any).status === 404 ? 404 : 409).json({ success: false, message: `อนุมัติไม่สำเร็จ: ${error.message}` })
    }
    if (error instanceof MonthCloseError) {
      return res.status(409).json({ success: false, message: `อนุมัติไม่สำเร็จ: ${error.message}` })
    }
    if (error instanceof StockMovementError) {
      // ทรานแซกชัน rollback ไปแล้ว คำขอจึงยังเป็น PENDING ให้ลองใหม่ได้
      return res.status(400).json({
        success: false,
        message: `อนุมัติไม่สำเร็จ: ${error.message}`,
      })
    }
    console.error('Approval decision error:', error)
    res.status(500).json({ success: false, message: 'Failed to process decision' })
  }
})

// Helper function to execute approved action
function executeApprovedAction(request: any, executorId: string, executorName: string, now: string) {
  // Update approval request
  db.prepare(`
    UPDATE approval_requests SET 
      final_executor_id = ?, final_executor_name = ?, executed_at = ?, status = 'EXECUTED'
    WHERE id = ? AND tenant_id = ?
  `).run(executorId, executorName, now, request.id, request.tenant_id)

  // Execute based on reference type
  // ยกเลิกเอกสารขาย (หมวด sales_cancel) — ต้องมาก่อน branch ตาม reference_type เพราะใช้ชื่อตารางเดียวกัน
  // ('receipts'/'sales_orders' ด้านล่างคือคำขอคนละเรื่อง: ยืนยันใบเสร็จ/ยืนยัน SO)
  // ยกเลิกไม่ผ่าน (เช่น มีใบแจ้งหนี้เกิดขึ้นระหว่างรอ) → SalesCancelError → rollback คำขอยัง PENDING
  if (request.module_type === 'sales_cancel') {
    executeSalesCancel(request, executorId)
  } else if (request.module_type === 'purchase_cancel') {
    executePurchaseCancel(request, executorId, executorName)
  } else if (request.module_type === 'close_adjust') {
    // รายการปรับปรุงปิดเดือน: post ด้วย service ตัวเดียวกับที่ GM กดอนุมัติเอง (ร่าง JV / รับชำระ / ยกเลิกใบจ่ายเงินที่ลงซ้ำ)
    const payload = request.payload ? JSON.parse(request.payload) : {}
    postCloseRecords(request.tenant_id, Array.isArray(payload.recordIds) ? payload.recordIds : [], executorName)
  } else if (request.reference_type === 'work_orders') {
    // Work order approved - can proceed to production
    db.prepare("UPDATE work_orders SET status = 'APPROVED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now, request.reference_id, request.tenant_id)
  } else if (request.reference_type === 'supplier_payments') {
    // Payment approved - mark as ready to pay
    db.prepare("UPDATE supplier_payments SET status = 'APPROVED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now, request.reference_id, request.tenant_id)
  } else if (request.reference_type === 'receipts') {
    // Receipt approved - mark as confirmed
    db.prepare("UPDATE receipts SET status = 'CONFIRMED', updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(now, request.reference_id, request.tenant_id)
  } else if (request.reference_type === 'sales_orders') {
    // เฉพาะ SO ที่ยังรออนุมัติอยู่ — SO ที่ถูกยกเลิกระหว่างรอ ต้องไม่ถูกปลุกกลับมาเป็น CONFIRMED + ตัดสต็อก
    const confirmed = db.prepare("UPDATE sales_orders SET status = 'CONFIRMED', approved_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'PENDING_APPROVAL'")
      .run(executorId, now, request.reference_id, request.tenant_id)
    // เดิมส่ง soNumber เป็น '' ทำให้ stock_movements บันทึก reference เป็น 'SO: ' เปล่าๆ —
    // soStockAlreadyDeducted() (เช็คก่อนตัดซ้ำ) และ restoreStockForSO ที่อื่นในระบบต่างก็ match
    // ด้วย 'SO: <เลขที่จริง>' ทั้งนั้น เลขว่างจึงทำให้กลไกกันตัดซ้ำ/คืนสต็อกใช้ไม่ได้กับ SO ที่ผ่านมาทางนี้
    const soRow = db.prepare('SELECT so_number FROM sales_orders WHERE id = ? AND tenant_id = ?')
      .get(request.reference_id, request.tenant_id) as any
    if (confirmed.changes > 0 && soRow && !soStockAlreadyDeducted(request.tenant_id, soRow.so_number)) {
      try { deductStockForSO(request.tenant_id, request.reference_id, soRow.so_number) } catch(e) { console.error('deductStock on approval:', e) }
    }
  } else if (request.reference_type === 'purchase_orders') {
    // หมวด "แก้ไขเอกสารที่ออกไปแล้ว": payload เก็บเป็น { before, update } ตอนสร้างคำขอ
    // ใช้ service เดียวกับที่ PUT /purchase-orders/:id เรียกตอนไม่ต้องขออนุมัติ — ไม่มีตรรกะซ้ำสองชุด
    const stored = request.payload ? JSON.parse(request.payload) : null
    if (stored?.update) {
      applyPurchaseOrderUpdate(request.tenant_id, request.reference_id, stored.update)
    }
  } else if (request.reference_type === 'stock_items') {
    // หมวด "ปรับ/เปลี่ยนสต็อก": args ที่พนักงานกดไว้ถูกเก็บใน payload ตอนสร้างคำขอ
    // แล้วรันด้วย service ตัวเดียวกับที่ POST /stock/movement ใช้ — ไม่มีตรรกะซ้ำสองชุด
    const payload = request.payload ? JSON.parse(request.payload) : null
    if (payload) {
      applyStockMovement(request.tenant_id, request.requester_name, payload)
    }
  } else if (request.reference_type === 'stock_unpack') {
    // หมวด "แกะแพ็คด้วยมือ": ผูก category เดียวกับ stock_adjust แต่ payload/ฟังก์ชันคนละตัว
    // เพราะแกะแพ็คคือย้าย sealed_qty→quantity ไม่ใช่ IN/OUT/ADJUST ปกติ — refType แยก
    // ('stock_unpack' vs 'stock_items') กันสับสนกับคำขอปรับสต็อกปกติของสินค้าเดียวกัน
    const unpackPayload = request.payload ? JSON.parse(request.payload) : null
    if (unpackPayload) {
      applyManualUnpack(request.tenant_id, request.requester_name, unpackPayload)
    }
  } else if (request.reference_type === 'pos_running_bills' && request.module_type === 'pos_discount') {
    // อนุมัติส่วนลด POS: บันทึกยอดส่วนลดที่อนุมัติลงบิลไว้ให้พร้อมรับชำระเงินทันที
    const discountAmt = Math.max(0, Number(request.amount) || 0)
    const upd = db.prepare("UPDATE pos_running_bills SET discount_amount = ? WHERE id = ? AND tenant_id = ? AND status = 'OPEN'")
      .run(discountAmt, request.reference_id, request.tenant_id)
    // บิลปิดไปแล้ว/ไม่ใช่ของ tenant นี้ ห้ามคำนวณยอดใหม่ (recalculate กรองแค่ id)
    if (upd.changes > 0) recalculateBillTotals(request.reference_id)
  }

  // Log execution
  db.prepare(`
    INSERT INTO approval_logs (id, tenant_id, approval_request_id, action, actor_id, actor_name, actor_role,
      comment, old_status, new_status, created_at)
    VALUES (?, ?, ?, 'EXECUTE', ?, ?, 'SYSTEM', ?, 'APPROVED', 'EXECUTED', ?)
  `).run(generateId(), request.tenant_id, request.id, executorId, executorName,
    'Action executed after approval', now)
}

// อนุมัติคำขอยกเลิกเอกสารขาย → ยกเลิกจริงด้วย executor ตัวเดียวกับที่ ADMIN ใช้ตอนกดเอง
function executeSalesCancel(request: any, executorId: string) {
  const payload = request.payload ? JSON.parse(request.payload) : {}
  const tenantId = request.tenant_id
  const refId = request.reference_id
  switch (payload.kind) {
    case 'sales_order': cancelSalesOrderNow(tenantId, refId); break
    case 'invoice': cancelInvoiceNow(tenantId, refId); break
    case 'receipt': voidReceiptNow(tenantId, refId); break
    case 'credit_note': cancelCreditNoteNow(tenantId, refId, executorId); break
    default: throw new SalesCancelError(400, `ไม่รู้จักชนิดเอกสารที่ขอยกเลิก (${payload.kind})`)
  }
}

// อนุมัติคำขอยกเลิกเอกสารซื้อ (D3) → executor ตัวเดียวกับที่คนมีสิทธิ์แผนกใช้ตอนกดเอง (เช็คเงื่อนไขซ้ำตอนรันจริง)
function executePurchaseCancel(request: any, executorId: string, executorName: string) {
  const payload = request.payload ? JSON.parse(request.payload) : {}
  const tenantId = request.tenant_id
  const refId = request.reference_id
  switch (payload.kind) {
    case 'purchase_order': cancelPurchaseOrderNow(tenantId, refId); break
    case 'goods_receipt': cancelGoodsReceiptNow(tenantId, refId, { userId: executorId, email: executorName }); break
    case 'purchase_invoice': cancelPurchaseInvoiceNow(tenantId, refId, executorName); break
    case 'supplier_payment': voidSupplierPaymentNow(tenantId, refId, executorName); break
    case 'purchase_return': cancelPurchaseReturnNow(tenantId, refId); break
    default: throw new PurchaseCancelError(400, `ไม่รู้จักชนิดเอกสารที่ขอยกเลิก (${payload.kind})`)
  }
}

// Helper function to revert reference status when rejected
function revertReferenceStatus(request: any) {
  // ปฏิเสธคำขอยกเลิกเอกสารขาย/ซื้อ = เอกสารคงสถานะเดิม ไม่ต้องย้อนอะไร (ห้ามตก branch supplier_payments/receipts ด้านล่าง)
  if (request.module_type === 'sales_cancel' || request.module_type === 'purchase_cancel') return
  if (request.module_type === 'close_adjust') return revertCloseApproval(request.tenant_id, request.id)
  if (request.reference_type === 'work_orders') {
    db.prepare("UPDATE work_orders SET status = 'DRAFT' WHERE id = ? AND tenant_id = ?").run(request.reference_id, request.tenant_id)
  } else if (request.reference_type === 'supplier_payments') {
    db.prepare("UPDATE supplier_payments SET status = 'DRAFT' WHERE id = ? AND tenant_id = ?").run(request.reference_id, request.tenant_id)
  } else if (request.reference_type === 'receipts') {
    db.prepare("UPDATE receipts SET status = 'DRAFT' WHERE id = ? AND tenant_id = ?").run(request.reference_id, request.tenant_id)
  } else if (request.reference_type === 'sales_orders') {
    db.prepare("UPDATE sales_orders SET status = 'DRAFT', updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'PENDING_APPROVAL'")
      .run(new Date().toISOString(), request.reference_id, request.tenant_id)
  } else if (request.reference_type === 'pos_running_bills' && request.module_type === 'pos_discount') {
    const upd = db.prepare("UPDATE pos_running_bills SET discount_amount = 0 WHERE id = ? AND tenant_id = ? AND status = 'OPEN'")
      .run(request.reference_id, request.tenant_id)
    if (upd.changes > 0) recalculateBillTotals(request.reference_id)
  }
}

export default router
