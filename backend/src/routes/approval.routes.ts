import { Router, Request, Response } from 'express'
import { authenticate, requireRole } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { randomUUID } from 'crypto'

const router = Router()

router.use(authenticate)

function generateId() {
  return randomUUID().replace(/-/g, '').substring(0, 25)
}

function generateNumber(prefix: string, tenantId: string, table: string) {
  const count = (db.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE tenant_id = ?`).get(tenantId) as any).count
  const year = new Date().getFullYear()
  return `${prefix}-${year}-${String(count + 1).padStart(5, '0')}`
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

// POST create/update approval setting (Master only)
router.post('/settings', requireRole('MASTER', 'ADMIN'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { role, moduleType, approvalRequired, autoApproveThreshold } = req.body
    
    if (!role || !moduleType) {
      return res.status(400).json({ success: false, message: 'Role and module type are required' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    // Upsert (insert or replace)
    db.prepare(`
      INSERT INTO approval_settings (id, tenant_id, role, module_type, approval_required, auto_approve_threshold, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, role, module_type) DO UPDATE SET
        approval_required = excluded.approval_required,
        auto_approve_threshold = excluded.auto_approve_threshold,
        updated_at = excluded.updated_at
    `).run(id, tenantId, role, moduleType, approvalRequired ? 1 : 0, autoApproveThreshold || 0, 
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
    const { userId, moduleType, canApprove, canApproveUnlimited, approvalLimit, isMasterApprover } = req.body
    
    if (!userId || !moduleType) {
      return res.status(400).json({ success: false, message: 'User ID and module type are required' })
    }

    const id = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO user_approval_permissions (id, tenant_id, user_id, module_type, can_approve, can_approve_unlimited, approval_limit, is_master_approver, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, user_id, module_type) DO UPDATE SET
        can_approve = excluded.can_approve,
        can_approve_unlimited = excluded.can_approve_unlimited,
        approval_limit = excluded.approval_limit,
        is_master_approver = excluded.is_master_approver,
        updated_at = excluded.updated_at
    `).run(id, tenantId, userId, moduleType, canApprove ? 1 : 0, canApproveUnlimited ? 1 : 0, 
      approvalLimit || 0, isMasterApprover ? 1 : 0, req.user!.userId, now, now)

    const permission = db.prepare('SELECT * FROM user_approval_permissions WHERE id = ?').get(id)
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

    // Default: no approval required if not set
    if (!setting) {
      return res.json({ 
        success: true, 
        data: { 
          required: false, 
          reason: 'No approval setting found for this role',
          autoApproveThreshold: 0
        } 
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
    
    // Get modules that user can approve
    const userPerms = db.prepare(`
      SELECT module_type FROM user_approval_permissions
      WHERE tenant_id = ? AND user_id = ? AND can_approve = 1
    `).all(tenantId, userId) as any[]

    const moduleTypes = userPerms.map(p => p.module_type)
    
    if (moduleTypes.length === 0) {
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
          WHEN 'stock_adjustments' THEN (SELECT adjustment_number FROM stock_adjustments WHERE id = ar.reference_id)
          ELSE ar.reference_id
        END as reference_number
      FROM approval_requests ar
      WHERE ar.tenant_id = ? 
        AND ar.module_type IN (${placeholders})
        AND ar.status = 'PENDING'
      ORDER BY ar.created_at DESC
    `).all(tenantId, ...moduleTypes)

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

// GET single approval request
router.get('/requests/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const request = db.prepare(`
      SELECT * FROM approval_requests WHERE id = ? AND tenant_id = ?
    `).get(req.params.id, tenantId)

    if (!request) {
      return res.status(404).json({ success: false, message: 'Approval request not found' })
    }

    const logs = db.prepare(`
      SELECT * FROM approval_logs 
      WHERE approval_request_id = ?
      ORDER BY created_at ASC
    `).all(req.params.id)

    res.json({ success: true, data: { ...request, logs } })
  } catch (error) {
    console.error('Get approval request error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch request' })
  }
})

// POST create approval request
router.post('/requests', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { moduleType, referenceType, referenceId, amount, description, metadata } = req.body
    
    if (!moduleType || !referenceType || !referenceId) {
      return res.status(400).json({ success: false, message: 'Module type, reference type and ID are required' })
    }

    // Check if already has pending request
    const existing = db.prepare(`
      SELECT * FROM approval_requests 
      WHERE tenant_id = ? AND reference_type = ? AND reference_id = ? AND status = 'PENDING'
    `).get(tenantId, referenceType, referenceId)

    if (existing) {
      return res.status(400).json({ success: false, message: 'Already has pending approval request', data: existing })
    }

    const id = generateId()
    const requestNumber = generateNumber('APR', tenantId, 'approval_requests')
    const now = new Date().toISOString()

    const transaction = db.transaction(() => {
      // Create approval request
      db.prepare(`
        INSERT INTO approval_requests (id, tenant_id, request_number, module_type, reference_type, reference_id,
          requester_id, requester_name, requester_role, amount, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
      `).run(id, tenantId, requestNumber, moduleType, referenceType, referenceId,
        req.user!.userId, req.user!.email, req.user!.role, amount || 0, description || '', now, now)

      // Log creation
      db.prepare(`
        INSERT INTO approval_logs (id, tenant_id, approval_request_id, action, actor_id, actor_name, actor_role, 
          comment, old_status, new_status, metadata, created_at)
        VALUES (?, ?, ?, 'CREATE', ?, ?, ?, ?, NULL, 'PENDING', ?, ?)
      `).run(generateId(), tenantId, id, req.user!.userId, req.user!.email, req.user!.role,
        'Created approval request', JSON.stringify(metadata || {}), now)

      // Update reference record status
      if (referenceType === 'work_orders') {
        db.prepare("UPDATE work_orders SET status = 'PENDING_APPROVAL' WHERE id = ?").run(referenceId)
      } else if (referenceType === 'supplier_payments') {
        db.prepare("UPDATE supplier_payments SET status = 'PENDING_APPROVAL' WHERE id = ?").run(referenceId)
      } else if (referenceType === 'receipts') {
        db.prepare("UPDATE receipts SET status = 'PENDING_APPROVAL' WHERE id = ?").run(referenceId)
      } else if (referenceType === 'stock_adjustments') {
        db.prepare("UPDATE stock_adjustments SET status = 'PENDING_APPROVAL' WHERE id = ?").run(referenceId)
      }
    })

    transaction()

    const request = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id)
    res.status(201).json({ success: true, data: request, message: 'Approval request created' })
  } catch (error) {
    console.error('Create approval request error:', error)
    res.status(500).json({ success: false, message: 'Failed to create approval request' })
  }
})

// PUT approve/reject request
router.put('/requests/:id/decision', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { decision, comment, level } = req.body  // decision: APPROVED/REJECTED, level: 1 or 2
    
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

    // Check if user has permission to approve this module
    const userPerm = db.prepare(`
      SELECT * FROM user_approval_permissions
      WHERE tenant_id = ? AND user_id = ? AND module_type = ?
    `).get(tenantId, req.user!.userId, request.module_type) as any

    if (!userPerm || userPerm.can_approve !== 1) {
      return res.status(403).json({ success: false, message: 'You do not have approval permission for this module' })
    }

    const now = new Date().toISOString()
    const isMasterApprover = userPerm.is_master_approver === 1
    const approvalLevel = level || (isMasterApprover ? 2 : 1)

    const transaction = db.transaction(() => {
      if (approvalLevel === 1) {
        // Level 1 approval (Department head)
        db.prepare(`
          UPDATE approval_requests SET
            approver_1_id = ?, approver_1_name = ?, approver_1_decision = ?, approver_1_comment = ?, approver_1_at = ?,
            ${decision === 'REJECTED' ? "status = 'REJECTED'," : ''}
            updated_at = ?
          WHERE id = ?
        `).run(req.user!.userId, req.user!.email, decision, comment || '', now, now, req.params.id)

        // Log
        db.prepare(`
          INSERT INTO approval_logs (id, tenant_id, approval_request_id, action, actor_id, actor_name, actor_role,
            comment, old_status, new_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
        `).run(generateId(), tenantId, req.params.id, decision, req.user!.userId, req.user!.email, 
          req.user!.role, comment || '', decision === 'REJECTED' ? 'REJECTED' : 'PENDING', now)

      } else {
        // Level 2 approval (Master approver)
        db.prepare(`
          UPDATE approval_requests SET
            approver_2_id = ?, approver_2_name = ?, approver_2_decision = ?, approver_2_comment = ?, approver_2_at = ?,
            status = ?,
            updated_at = ?
          WHERE id = ?
        `).run(req.user!.userId, req.user!.email, decision, comment || '', now, decision, now, req.params.id)

        // Log
        db.prepare(`
          INSERT INTO approval_logs (id, tenant_id, approval_request_id, action, actor_id, actor_name, actor_role,
            comment, old_status, new_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
        `).run(generateId(), tenantId, req.params.id, decision, req.user!.userId, req.user!.email,
          req.user!.role, comment || '', decision, now)

        // If approved, execute the action
        if (decision === 'APPROVED') {
          executeApprovedAction(request, req.user!.userId, req.user!.email, now)
        } else {
          // Rejected - revert reference status
          revertReferenceStatus(request)
        }
      }
    })

    transaction()

    const updated = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(req.params.id)
    res.json({ success: true, data: updated, message: `Request ${decision.toLowerCase()}` })
  } catch (error) {
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
    WHERE id = ?
  `).run(executorId, executorName, now, request.id)

  // Execute based on reference type
  if (request.reference_type === 'work_orders') {
    // Work order approved - can proceed to production
    db.prepare("UPDATE work_orders SET status = 'APPROVED', updated_at = ? WHERE id = ?")
      .run(now, request.reference_id)
  } else if (request.reference_type === 'supplier_payments') {
    // Payment approved - mark as ready to pay
    db.prepare("UPDATE supplier_payments SET status = 'APPROVED', updated_at = ? WHERE id = ?")
      .run(now, request.reference_id)
  } else if (request.reference_type === 'receipts') {
    // Receipt approved - mark as confirmed
    db.prepare("UPDATE receipts SET status = 'CONFIRMED', updated_at = ? WHERE id = ?")
      .run(now, request.reference_id)
  } else if (request.reference_type === 'stock_adjustments') {
    // Stock adjustment approved - execute the adjustment
    const adj = db.prepare('SELECT * FROM stock_adjustments WHERE id = ?').get(request.reference_id) as any
    if (adj) {
      // Update stock
      const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(adj.stock_item_id) as any
      if (stockItem) {
        const newQty = adj.quantity_after
        db.prepare('UPDATE stock_items SET quantity = ?, updated_at = ? WHERE id = ?')
          .run(newQty, now, adj.stock_item_id)

        // Record movement
        db.prepare(`
          INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(generateId(), request.tenant_id, adj.stock_item_id, 
          adj.adjustment_type === 'INCREASE' ? 'ADJ_IN' : 'ADJ_OUT',
          Math.abs(adj.quantity_adjusted), `ADJ:${adj.adjustment_number}`,
          `Manual adjustment approved: ${adj.reason}`, now, executorId)
      }

      db.prepare("UPDATE stock_adjustments SET status = 'EXECUTED', updated_at = ? WHERE id = ?")
        .run(now, request.reference_id)
    }
  }

  // Log execution
  db.prepare(`
    INSERT INTO approval_logs (id, tenant_id, approval_request_id, action, actor_id, actor_name, actor_role,
      comment, old_status, new_status, created_at)
    VALUES (?, ?, ?, 'EXECUTE', ?, ?, 'SYSTEM', ?, 'APPROVED', 'EXECUTED', ?)
  `).run(generateId(), request.tenant_id, request.id, executorId, executorName,
    'Action executed after approval', now)
}

// Helper function to revert reference status when rejected
function revertReferenceStatus(request: any) {
  if (request.reference_type === 'work_orders') {
    db.prepare("UPDATE work_orders SET status = 'DRAFT' WHERE id = ?").run(request.reference_id)
  } else if (request.reference_type === 'supplier_payments') {
    db.prepare("UPDATE supplier_payments SET status = 'DRAFT' WHERE id = ?").run(request.reference_id)
  } else if (request.reference_type === 'receipts') {
    db.prepare("UPDATE receipts SET status = 'DRAFT' WHERE id = ?").run(request.reference_id)
  } else if (request.reference_type === 'stock_adjustments') {
    db.prepare("UPDATE stock_adjustments SET status = 'REJECTED' WHERE id = ?").run(request.reference_id)
  }
}

// ============================================
// STOCK ADJUSTMENTS (Manual)
// ============================================

// GET all stock adjustments
router.get('/stock-adjustments', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    
    const adjustments = db.prepare(`
      SELECT sa.*, si.sku, si.name as stock_name, m.name as material_name, m.code as material_code
      FROM stock_adjustments sa
      LEFT JOIN stock_items si ON sa.stock_item_id = si.id
      LEFT JOIN materials m ON si.material_id = m.id
      WHERE sa.tenant_id = ?
      ORDER BY sa.created_at DESC
    `).all(tenantId)

    res.json({ success: true, data: adjustments })
  } catch (error) {
    console.error('Get stock adjustments error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch adjustments' })
  }
})

// POST create stock adjustment
router.post('/stock-adjustments', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { stockItemId, adjustmentType, quantityAdjusted, unitCost, reason, notes } = req.body
    
    if (!stockItemId || !adjustmentType || !quantityAdjusted || !reason) {
      return res.status(400).json({ success: false, message: 'Required fields missing' })
    }

    const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(stockItemId, tenantId) as any
    if (!stockItem) {
      return res.status(404).json({ success: false, message: 'Stock item not found' })
    }

    const qtyBefore = stockItem.quantity
    const qtyAdjusted = parseFloat(quantityAdjusted)
    let qtyAfter = qtyBefore

    if (adjustmentType === 'INCREASE') {
      qtyAfter = qtyBefore + qtyAdjusted
    } else if (adjustmentType === 'DECREASE') {
      qtyAfter = qtyBefore - qtyAdjusted
      if (qtyAfter < 0) {
        return res.status(400).json({ success: false, message: 'Insufficient stock for decrease' })
      }
    } else {
      qtyAfter = qtyAdjusted  // CORRECTION
    }

    const id = generateId()
    const adjNumber = generateNumber('ADJ', tenantId, 'stock_adjustments')
    const now = new Date().toISOString()
    const totalValue = (unitCost || 0) * Math.abs(qtyAdjusted)

    db.prepare(`
      INSERT INTO stock_adjustments (id, tenant_id, adjustment_number, stock_item_id, adjustment_type,
        quantity_before, quantity_after, quantity_adjusted, unit_cost, total_value, reason, notes,
        status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `).run(id, tenantId, adjNumber, stockItemId, adjustmentType, qtyBefore, qtyAfter,
      qtyAdjusted, unitCost || 0, totalValue, reason, notes || '', req.user!.userId, now, now)

    const adjustment = db.prepare('SELECT * FROM stock_adjustments WHERE id = ?').get(id)
    res.status(201).json({ success: true, data: adjustment, message: 'Stock adjustment created and pending approval' })
  } catch (error) {
    console.error('Create stock adjustment error:', error)
    res.status(500).json({ success: false, message: 'Failed to create adjustment' })
  }
})

export default router
