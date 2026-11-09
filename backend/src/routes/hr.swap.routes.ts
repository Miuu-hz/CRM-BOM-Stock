import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { can } from '../services/rbac.service'
import { createRequest, recordAutoAction, hasBypass, GateUser } from '../services/approvalGate.service'
import { isIsoDate, listShifts, getEffectiveCells, RosterShift } from '../services/hr/rosterData'

// สัญญากลาง: docs/contracts/hr-phase7.md — คำขอแลกกะ (งาน B7b)
const router = Router()

function userHasHr(req: Request, action: 'read' | 'write'): boolean {
  if (!req.user) return false
  return can(
    req.user.role,
    req.user.departments || [],
    'hr',
    action,
    req.user.customPermissions
  )
}

function getSelfEmployee(tenantId: string, userId: string) {
  return db.prepare(
    `SELECT * FROM employees WHERE tenant_id = ? AND user_id = ? AND status = 'ACTIVE'`
  ).get(tenantId, userId) as any
}

const SWAP_SELECT = `
  SELECT
    s.*,
    re.first_name AS req_first_name, re.last_name AS req_last_name,
    te.first_name AS target_first_name, te.last_name AS target_last_name
  FROM shift_swaps s
  JOIN employees re ON s.requester_employee_id = re.id AND re.tenant_id = s.tenant_id
  JOIN employees te ON s.target_employee_id = te.id AND te.tenant_id = s.tenant_id
`

function formatShiftSwap(tenantId: string, row: any, shiftMap?: Map<string, RosterShift>) {
  const shifts = shiftMap || new Map(listShifts(tenantId).map((s) => [s.id, s]))
  // ponytail: คำนวณกะที่มีผลของคู่แลก ณ เวลาเรียก (getEffectiveCells ชนะกะประจำ)
  const cells = getEffectiveCells(tenantId, [row.work_date], [row.requester_employee_id, row.target_employee_id])
  const reqCell = cells.get(row.requester_employee_id)?.[0]
  const targetCell = cells.get(row.target_employee_id)?.[0]

  const reqShift = reqCell?.shift_id ? shifts.get(reqCell.shift_id) ?? null : null
  const targetShift = targetCell?.shift_id ? shifts.get(targetCell.shift_id) ?? null : null

  const reqName = `${row.req_first_name || ''} ${row.req_last_name || ''}`.trim()
  const targetName = `${row.target_first_name || ''} ${row.target_last_name || ''}`.trim()

  return {
    id: row.id,
    work_date: row.work_date,
    requester_employee_id: row.requester_employee_id,
    requester_name: reqName,
    target_employee_id: row.target_employee_id,
    target_name: targetName,
    requester_shift: reqShift,
    target_shift: targetShift,
    reason: row.reason ?? null,
    status: row.status,
    approval_request_id: row.approval_request_id ?? null,
    peer_decided_at: row.peer_decided_at ?? null,
    decided_by: row.decided_by ?? null,
    decided_at: row.decided_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? null,
  }
}

function getShiftSwapById(tenantId: string, id: string) {
  const row = db.prepare(`${SWAP_SELECT} WHERE s.id = ? AND s.tenant_id = ?`).get(id, tenantId) as any
  if (!row) return null
  return formatShiftSwap(tenantId, row)
}

// S1: POST /me/shift-swaps (self)
router.post('/me/shift-swaps', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)
    if (!selfEmp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const { target_employee_id, work_date, reason } = req.body || {}

    if (!target_employee_id || typeof target_employee_id !== 'string') {
      return res.status(400).json({ success: false, message: 'กรุณาระบุพนักงานที่ต้องการขอแลกกะ' })
    }

    if (target_employee_id === selfEmp.id) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถขอแลกกะกับตนเองได้' })
    }

    if (!work_date || !isIsoDate(work_date)) {
      return res.status(400).json({ success: false, message: 'วันที่ไม่ถูกต้อง' })
    }

    const today = thaiDateStr()
    if (work_date < today) {
      return res.status(400).json({ success: false, message: 'วันที่ต้องไม่เป็นอดีต' })
    }

    const targetEmp = db.prepare(
      'SELECT id, code, first_name, last_name, status FROM employees WHERE id = ? AND tenant_id = ?'
    ).get(target_employee_id, tenantId) as any

    if (!targetEmp) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
    }
    if (targetEmp.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'พนักงานไม่อยู่ในสถานะปฏิบัติงาน' })
    }

    const cells = getEffectiveCells(tenantId, [work_date], [selfEmp.id, target_employee_id])
    const reqCell = cells.get(selfEmp.id)?.[0]
    const targetCell = cells.get(target_employee_id)?.[0]

    if (!reqCell || !targetCell) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถตรวจสอบกะของพนักงานได้' })
    }

    if (reqCell.on_leave || targetCell.on_leave) {
      return res.status(400).json({ success: false, message: 'มีพนักงานที่ลาในวันที่เลือก' })
    }

    if (reqCell.shift_id === targetCell.shift_id) {
      return res.status(400).json({ success: false, message: 'กะของทั้งสองคนเหมือนกัน ไม่ต้องแลก' })
    }

    const existing = db.prepare(`
      SELECT 1 FROM shift_swaps
      WHERE tenant_id = ?
        AND work_date = ?
        AND status IN ('PEER_PENDING', 'PENDING')
        AND (
          requester_employee_id IN (?, ?) OR
          target_employee_id IN (?, ?)
        )
      LIMIT 1
    `).get(tenantId, work_date, selfEmp.id, target_employee_id, selfEmp.id, target_employee_id)

    if (existing) {
      return res.status(409).json({ success: false, message: 'มีคำขอแลกกะที่รอดำเนินการในวันนี้แล้ว' })
    }

    const id = generateId()
    const now = new Date().toISOString()
    const reasonStr = typeof reason === 'string' && reason.trim() ? reason.trim() : null

    db.prepare(`
      INSERT INTO shift_swaps (
        id, tenant_id, work_date, requester_employee_id, target_employee_id,
        reason, status, approval_request_id, requested_by,
        peer_decided_at, decided_by, decided_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PEER_PENDING', NULL, ?, NULL, NULL, NULL, ?, ?)
    `).run(id, tenantId, work_date, selfEmp.id, target_employee_id, reasonStr, req.user!.userId, now, now)

    const data = getShiftSwapById(tenantId, id)
    res.status(201).json({ success: true, data })
  } catch (err: any) {
    console.error('Create shift swap error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// S2: GET /me/shift-swaps (self)
router.get('/me/shift-swaps', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)
    if (!selfEmp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const rows = db.prepare(`
      ${SWAP_SELECT}
      WHERE s.tenant_id = ?
        AND (s.requester_employee_id = ? OR s.target_employee_id = ?)
      ORDER BY s.created_at DESC
    `).all(tenantId, selfEmp.id, selfEmp.id) as any[]

    const shiftMap = new Map(listShifts(tenantId).map((s) => [s.id, s]))
    const data = rows.map((r) => formatShiftSwap(tenantId, r, shiftMap))
    res.json({ success: true, data })
  } catch (err: any) {
    console.error('Get my shift swaps error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// S3: POST /me/shift-swaps/:id/accept (target เท่านั้น)
router.post('/me/shift-swaps/:id/accept', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)
    if (!selfEmp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const row = db.prepare(`${SWAP_SELECT} WHERE s.id = ? AND s.tenant_id = ?`).get(req.params.id, tenantId) as any
    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบคำขอแลกกะ' })
    }

    if (row.target_employee_id !== selfEmp.id) {
      return res.status(403).json({ success: false, message: 'เฉพาะผู้ถูกขอแลกกะเท่านั้นที่สามารถตอบรับได้' })
    }

    if (row.status !== 'PEER_PENDING') {
      return res.status(409).json({ success: false, message: 'คำขอนี้ไม่อยู่ในสถานะรอตอบรับ' })
    }

    const gateUser: GateUser = {
      userId: req.user!.userId,
      email: req.user!.email,
      role: req.user!.role,
      departments: req.user!.departments,
      customPermissions: req.user!.customPermissions,
    }

    const now = new Date().toISOString()
    const autoApprove = hasBypass(tenantId, gateUser, 'shift_swap')

    if (autoApprove) {
      // ponytail: กรณี bypass/ไม่ต้องอนุมัติ — สลับกะทันทีแบบเดียวกับ executeApprovedAction ใน approval.routes.ts
      db.transaction(() => {
        const effective = (empId: string): string | null => {
          const a = db.prepare('SELECT shift_id FROM shift_assignments WHERE tenant_id = ? AND employee_id = ? AND work_date = ?').get(tenantId, empId, row.work_date) as { shift_id: string | null } | undefined
          if (a) return a.shift_id
          return (db.prepare('SELECT shift_id FROM employees WHERE id = ? AND tenant_id = ?').get(empId, tenantId) as { shift_id: string | null } | undefined)?.shift_id ?? null
        }
        const r = effective(row.requester_employee_id)
        const t = effective(row.target_employee_id)
        const upsert = db.prepare(`
          INSERT INTO shift_assignments (id, tenant_id, employee_id, work_date, shift_id, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tenant_id, employee_id, work_date) DO UPDATE SET shift_id = excluded.shift_id, updated_at = excluded.updated_at
        `)
        upsert.run(generateId(), tenantId, row.requester_employee_id, row.work_date, t, req.user!.userId, now, now)
        upsert.run(generateId(), tenantId, row.target_employee_id, row.work_date, r, req.user!.userId, now, now)

        db.prepare(`
          UPDATE shift_swaps
          SET status = 'APPROVED', peer_decided_at = ?, decided_by = ?, decided_at = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?
        `).run(now, req.user!.userId, now, now, row.id, tenantId)
      })()

      recordAutoAction({
        tenantId,
        user: gateUser,
        category: 'shift_swap',
        refType: 'shift_swaps',
        refId: row.id,
        description: `แลกกะ ${row.work_date} ระหว่าง ${row.req_first_name} กับ ${row.target_first_name} (อนุมัติทันที)`,
        amount: 0,
      })
    } else {
      const reqName = `${row.req_first_name || ''} ${row.req_last_name || ''}`.trim()
      const targetName = `${row.target_first_name || ''} ${row.target_last_name || ''}`.trim()
      const desc = `ขอแลกกะ ${row.work_date} (${reqName} ↔ ${targetName})`

      const apr = createRequest({
        tenantId,
        user: gateUser,
        category: 'shift_swap',
        refType: 'shift_swaps',
        refId: row.id,
        description: desc,
        amount: 0,
      })

      db.prepare(`
        UPDATE shift_swaps
        SET status = 'PENDING', approval_request_id = ?, peer_decided_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(apr.id, now, now, row.id, tenantId)
    }

    const data = getShiftSwapById(tenantId, row.id)
    res.json({ success: true, data })
  } catch (err: any) {
    console.error('Accept shift swap error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// S4: POST /me/shift-swaps/:id/decline (target เท่านั้น)
router.post('/me/shift-swaps/:id/decline', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)
    if (!selfEmp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const row = db.prepare('SELECT * FROM shift_swaps WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบคำขอแลกกะ' })
    }

    if (row.target_employee_id !== selfEmp.id) {
      return res.status(403).json({ success: false, message: 'เฉพาะผู้ถูกขอแลกกะเท่านั้นที่สามารถปฏิเสธได้' })
    }

    if (row.status !== 'PEER_PENDING') {
      return res.status(409).json({ success: false, message: 'คำขอนี้ไม่อยู่ในสถานะรอตอบรับ' })
    }

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE shift_swaps
      SET status = 'DECLINED', peer_decided_at = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(now, now, row.id, tenantId)

    const data = getShiftSwapById(tenantId, row.id)
    res.json({ success: true, data })
  } catch (err: any) {
    console.error('Decline shift swap error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// S5: POST /shift-swaps/:id/cancel (ผู้ขอ หรือ hr:write)
router.post('/shift-swaps/:id/cancel', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const row = db.prepare(`
      SELECT s.*, re.user_id AS req_user_id
      FROM shift_swaps s
      JOIN employees re ON s.requester_employee_id = re.id AND re.tenant_id = s.tenant_id
      WHERE s.id = ? AND s.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบคำขอแลกกะ' })
    }

    const isOwner = row.requested_by === req.user!.userId || row.req_user_id === req.user!.userId
    const hasHrWrite = userHasHr(req, 'write')
    if (!isOwner && !hasHrWrite) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกคำขอนี้' })
    }

    if (row.status !== 'PEER_PENDING' && row.status !== 'PENDING') {
      return res.status(409).json({ success: false, message: 'ไม่สามารถยกเลิกคำขอนี้ได้' })
    }

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE shift_swaps
      SET status = 'CANCELLED', updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(now, row.id, tenantId)

    // ponytail: ยกเลิกคำขออนุมัติที่ค้างอยู่ (ถ้ามี) แบบเดียวกับ hr.leave.routes.ts
    if (row.approval_request_id) {
      const apr = db.prepare(
        'SELECT id, status FROM approval_requests WHERE id = ? AND tenant_id = ?'
      ).get(row.approval_request_id, tenantId) as any

      if (apr && apr.status === 'PENDING') {
        db.prepare(`
          UPDATE approval_requests
          SET status = 'CANCELLED', updated_at = ?
          WHERE id = ? AND tenant_id = ?
        `).run(now, apr.id, tenantId)

        db.prepare(`
          INSERT INTO approval_logs (
            id, tenant_id, approval_request_id, action, actor_id, actor_name, actor_role,
            comment, old_status, new_status, created_at
          ) VALUES (?, ?, ?, 'CANCEL', ?, ?, ?, 'ผู้ขอยกเลิกเอง', 'PENDING', 'CANCELLED', ?)
        `).run(
          generateId(),
          tenantId,
          apr.id,
          req.user!.userId,
          req.user!.email,
          req.user!.role,
          now
        )
      }
    }

    const data = getShiftSwapById(tenantId, row.id)
    res.json({ success: true, data })
  } catch (err: any) {
    console.error('Cancel shift swap error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// S6: GET /shift-swaps (hr:read)
router.get('/shift-swaps', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const status = req.query.status as string | undefined

    let query = `${SWAP_SELECT} WHERE s.tenant_id = ?`
    const params: any[] = [tenantId]

    if (status && typeof status === 'string' && status.trim()) {
      query += ' AND s.status = ?'
      params.push(status.trim())
    }

    query += ' ORDER BY s.created_at DESC LIMIT 500'

    const rows = db.prepare(query).all(...params) as any[]
    const shiftMap = new Map(listShifts(tenantId).map((s) => [s.id, s]))
    const data = rows.map((r) => formatShiftSwap(tenantId, r, shiftMap))

    res.json({ success: true, data })
  } catch (err: any) {
    console.error('Get shift swaps error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
