import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { can } from '../services/rbac.service'
import { createRequest } from '../services/approvalGate.service'

// ขอทำงานนอกสถานที่ — สัญญากลาง docs/contracts/hr-offsite.md (งาน O1)
const router = Router()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDate(val: unknown): val is string {
  if (typeof val !== 'string' || !DATE_RE.test(val)) return false
  const d = new Date(`${val}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === val
}

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

function formatRow(r: any) {
  return {
    id: r.id,
    employee_id: r.employee_id,
    employee_code: r.employee_code,
    employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    start_date: r.start_date,
    end_date: r.end_date,
    place: r.place,
    reason: r.reason ?? null,
    status: r.status,
    decided_at: r.decided_at ?? null,
    created_at: r.created_at,
  }
}

// GET /hr/offsite-requests?mine=1&status=&from=&to=
router.get('/offsite-requests', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const mine = req.query.mine === '1' || req.query.mine === 'true'
    const conditions: string[] = ['o.tenant_id = ?']
    const params: any[] = [tenantId]

    if (mine) {
      const selfEmp = getSelfEmployee(tenantId, req.user!.userId)
      if (!selfEmp) {
        return res.status(403).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
      }
      conditions.push('o.employee_id = ?')
      params.push(selfEmp.id)
    } else if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    if (typeof req.query.status === 'string' && req.query.status.trim()) {
      conditions.push('o.status = ?')
      params.push(req.query.status.trim())
    }

    if (typeof req.query.from === 'string' && req.query.from.trim()) {
      const fromStr = req.query.from.trim()
      if (!isValidDate(fromStr)) {
        return res.status(400).json({ success: false, message: 'วันที่เริ่มต้นไม่ถูกต้อง' })
      }
      conditions.push('o.end_date >= ?')
      params.push(fromStr)
    }

    if (typeof req.query.to === 'string' && req.query.to.trim()) {
      const toStr = req.query.to.trim()
      if (!isValidDate(toStr)) {
        return res.status(400).json({ success: false, message: 'วันที่สิ้นสุดไม่ถูกต้อง' })
      }
      conditions.push('o.start_date <= ?')
      params.push(toStr)
    }

    const rows = db.prepare(`
      SELECT
        o.id,
        o.employee_id,
        e.code AS employee_code,
        e.first_name,
        e.last_name,
        o.start_date,
        o.end_date,
        o.place,
        o.reason,
        o.status,
        o.decided_at,
        o.created_at
      FROM offsite_requests o
      JOIN employees e ON o.employee_id = e.id AND e.tenant_id = o.tenant_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY o.start_date DESC, o.created_at DESC
      LIMIT 200
    `).all(...params) as any[]

    res.json({ success: true, data: rows.map(formatRow) })
  } catch (err: any) {
    console.error('Get offsite requests error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /hr/offsite-requests (ไม่ส่ง employee_id = ขอให้ตัวเอง · ส่งของคนอื่นต้องมี hr:write)
router.post('/offsite-requests', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const hasHrWrite = userHasHr(req, 'write')
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)

    const { employee_id, start_date, end_date, place, reason } = req.body || {}
    const requestedEmpId =
      typeof employee_id === 'string' && employee_id.trim() ? employee_id.trim() : undefined

    let emp: any
    if (!requestedEmpId || (selfEmp && requestedEmpId === selfEmp.id)) {
      if (!selfEmp) {
        return res.status(403).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
      }
      emp = selfEmp
    } else {
      if (!hasHrWrite) {
        return res.status(403).json({ success: false, message: 'สามารถขอทำงานนอกสถานที่ให้ตนเองเท่านั้น' })
      }
      emp = db.prepare(
        'SELECT id, code, first_name, last_name, status FROM employees WHERE id = ? AND tenant_id = ?'
      ).get(requestedEmpId, tenantId) as any
      if (!emp) {
        return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
      }
      if (emp.status !== 'ACTIVE') {
        return res.status(400).json({ success: false, message: 'พนักงานไม่อยู่ในสถานะปฏิบัติงาน' })
      }
    }

    if (!isValidDate(start_date) || !isValidDate(end_date)) {
      return res.status(400).json({ success: false, message: 'วันที่ไม่ถูกต้อง' })
    }
    if (start_date > end_date) {
      return res.status(400).json({ success: false, message: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น' })
    }

    const d1 = new Date(`${start_date}T00:00:00Z`).getTime()
    const d2 = new Date(`${end_date}T00:00:00Z`).getTime()
    const calendarDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1
    if (calendarDays > 31) {
      return res.status(400).json({ success: false, message: 'ขอทำงานนอกสถานที่ได้ครั้งละไม่เกิน 31 วัน' })
    }

    if (start_date < thaiDateStr()) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถขอทำงานนอกสถานที่ย้อนหลังได้' })
    }

    const placeStr = typeof place === 'string' ? place.trim() : ''
    if (!placeStr) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุสถานที่ปฏิบัติงาน' })
    }
    if (placeStr.length > 200) {
      return res.status(400).json({ success: false, message: 'สถานที่ต้องยาวไม่เกิน 200 ตัวอักษร' })
    }

    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      return res.status(400).json({ success: false, message: 'เหตุผลไม่ถูกต้อง' })
    }
    const reasonTrimmed = typeof reason === 'string' ? reason.trim() : ''
    if (reasonTrimmed.length > 500) {
      return res.status(400).json({ success: false, message: 'เหตุผลต้องยาวไม่เกิน 500 ตัวอักษร' })
    }
    const reasonStr = reasonTrimmed || null

    const overlap = db.prepare(`
      SELECT 1 FROM offsite_requests
      WHERE tenant_id = ?
        AND employee_id = ?
        AND status IN ('PENDING', 'APPROVED')
        AND start_date <= ?
        AND end_date >= ?
      LIMIT 1
    `).get(tenantId, emp.id, end_date, start_date)

    if (overlap) {
      return res.status(409).json({ success: false, message: 'มีคำขอทำงานนอกสถานที่ช่วงนี้อยู่แล้ว' })
    }

    const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim()
    const dateLabel = start_date === end_date ? start_date : `${start_date}–${end_date}`
    const desc = `ขอทำงานนอกสถานที่ ${dateLabel} · ${placeStr} (${empName})`

    const id = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO offsite_requests (
        id, tenant_id, employee_id, start_date, end_date, place,
        reason, status, approval_request_id, requested_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, ?)
    `).run(
      id,
      tenantId,
      emp.id,
      start_date,
      end_date,
      placeStr,
      reasonStr,
      req.user!.userId,
      now,
      now
    )

    const apr = createRequest({
      tenantId,
      user: {
        userId: req.user!.userId,
        email: req.user!.email,
        role: req.user!.role,
        departments: req.user!.departments,
        customPermissions: req.user!.customPermissions,
      },
      category: 'offsite',
      refType: 'offsite_requests',
      refId: id,
      description: desc,
      amount: 0,
    })

    db.prepare(
      'UPDATE offsite_requests SET approval_request_id = ? WHERE id = ? AND tenant_id = ?'
    ).run(apr.id, id, tenantId)

    res.status(201).json({
      success: true,
      data: formatRow({
        id,
        employee_id: emp.id,
        employee_code: emp.code,
        first_name: emp.first_name,
        last_name: emp.last_name,
        start_date,
        end_date,
        place: placeStr,
        reason: reasonStr,
        status: 'PENDING',
        decided_at: null,
        created_at: now,
      }),
    })
  } catch (err: any) {
    console.error('Create offsite request error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /hr/offsite-requests/:id/cancel (เจ้าของยกเลิกได้เมื่อ PENDING · hr:write ยกเลิกได้ทั้ง PENDING และ APPROVED)
router.post('/offsite-requests/:id/cancel', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const row = db.prepare(`
      SELECT o.*, e.user_id AS employee_user_id, e.code AS employee_code,
             e.first_name, e.last_name
      FROM offsite_requests o
      JOIN employees e ON o.employee_id = e.id AND e.tenant_id = o.tenant_id
      WHERE o.id = ? AND o.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบคำขอทำงานนอกสถานที่' })
    }

    const isOwner = row.requested_by === req.user!.userId || row.employee_user_id === req.user!.userId
    const hasHrWrite = userHasHr(req, 'write')
    if (!isOwner && !hasHrWrite) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกคำขอนี้' })
    }

    const canCancel =
      row.status === 'PENDING' ||
      (hasHrWrite && row.status === 'APPROVED')

    if (!canCancel) {
      return res.status(409).json({ success: false, message: 'ไม่สามารถยกเลิกคำขอนี้ได้' })
    }

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE offsite_requests
      SET status = 'CANCELLED', updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(now, row.id, tenantId)

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

    res.json({
      success: true,
      data: formatRow({ ...row, status: 'CANCELLED' }),
    })
  } catch (err: any) {
    console.error('Cancel offsite request error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
