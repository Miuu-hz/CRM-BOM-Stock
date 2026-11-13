import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { can } from '../services/rbac.service'
import { renderPdf, sendPdf } from '../services/hr/pdf'

// HR Phase 10B — วินัย หนังสือเตือน ข้อบังคับการทำงาน (สัญญากลาง docs/contracts/hr-phase9-11.md)
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

/**
 * Section 119: expires_on = incident_date + 1 year.
 * Computed strictly on the server from incident_date.
 * Clamps leap day 29 Feb to 28 Feb in non-leap years.
 */
export function computeDisciplinaryExpiresOn(incidentDate: string): string {
  const [yStr, mStr, dStr] = incidentDate.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const d = Number(dStr)

  const targetYear = y + 1
  const daysInMonth = new Date(Date.UTC(targetYear, m, 0)).getUTCDate()
  const targetDay = Math.min(d, daysInMonth)

  const pad = (n: number) => String(n).padStart(2, '0')
  return `${targetYear}-${pad(m)}-${pad(targetDay)}`
}

function formatWorkRuleRow(r: any) {
  return {
    id: r.id,
    clause_no: r.clause_no,
    title: r.title,
    body: r.body ?? null,
    announced_on: r.announced_on ?? null,
    is_active: Boolean(r.is_active),
    created_at: r.created_at,
  }
}

function formatDisciplinaryRow(r: any, today: string) {
  return {
    id: r.id,
    employee_id: r.employee_id,
    employee_code: r.employee_code ?? null,
    employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    incident_date: r.incident_date,
    category: r.category,
    detail: r.detail,
    level: r.level,
    work_rule_id: r.work_rule_id ?? null,
    clause_no: r.clause_no ?? null,
    work_rule_title: r.work_rule_title ?? null,
    expires_on: r.expires_on,
    active: today <= r.expires_on,
    acknowledged_at: r.acknowledged_at ?? null,
    acknowledged_via: r.acknowledged_via ?? null,
    witness_name: r.witness_name ?? null,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    attachment_count: Number(r.attachment_count || 0),
  }
}

// ==================== ข้อบังคับการทำงาน (hr_work_rules) ====================

// GET /work-rules (hr:read)
router.get('/work-rules', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const activeOnly = req.query.active === '1'

    const rows = db.prepare(`
      SELECT id, tenant_id, clause_no, title, body, announced_on, is_active, created_at
      FROM hr_work_rules
      WHERE tenant_id = ? ${activeOnly ? 'AND is_active = 1' : ''}
      ORDER BY clause_no ASC, created_at ASC
    `).all(tenantId) as any[]

    res.json({ success: true, data: rows.map(formatWorkRuleRow) })
  } catch (err: any) {
    console.error('Get work rules error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /work-rules (hr:write)
router.post('/work-rules', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId

    const clause_no = typeof req.body.clause_no === 'string' ? req.body.clause_no.trim() : ''
    if (!clause_no || clause_no.length > 200) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุข้อที่/หมวดข้อบังคับ (ความยาวไม่เกิน 200 ตัวอักษร)' })
    }

    const title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
    if (!title || title.length > 200) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อข้อบังคับ (ความยาวไม่เกิน 200 ตัวอักษร)' })
    }

    const body = typeof req.body.body === 'string' ? req.body.body.trim() : ''
    if (body && body.length > 5000) {
      return res.status(400).json({ success: false, message: 'รายละเอียดต้องมีความยาวไม่เกิน 5,000 ตัวอักษร' })
    }

    let announced_on: string | null = null
    if (req.body.announced_on !== undefined && req.body.announced_on !== null && req.body.announced_on !== '') {
      if (!isValidDate(req.body.announced_on)) {
        return res.status(400).json({ success: false, message: 'วันที่ประกาศไม่ถูกต้อง' })
      }
      announced_on = req.body.announced_on
    }

    const isActive = req.body.is_active === false ? 0 : 1
    const id = generateId()
    const createdAt = new Date().toISOString()

    db.prepare(`
      INSERT INTO hr_work_rules (id, tenant_id, clause_no, title, body, announced_on, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, clause_no, title, body || null, announced_on, isActive, createdAt)

    const created = db.prepare(`
      SELECT id, tenant_id, clause_no, title, body, announced_on, is_active, created_at
      FROM hr_work_rules WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId)

    res.status(201).json({ success: true, data: formatWorkRuleRow(created) })
  } catch (err: any) {
    console.error('Create work rule error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// PUT /work-rules/:id (hr:write)
router.put('/work-rules/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const id = req.params.id

    const existing = db.prepare(`
      SELECT * FROM hr_work_rules WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อบังคับการทำงาน' })
    }

    let clause_no = existing.clause_no
    if (req.body.clause_no !== undefined) {
      const val = typeof req.body.clause_no === 'string' ? req.body.clause_no.trim() : ''
      if (!val || val.length > 200) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุข้อที่/หมวดข้อบังคับ (ความยาวไม่เกิน 200 ตัวอักษร)' })
      }
      clause_no = val
    }

    let title = existing.title
    if (req.body.title !== undefined) {
      const val = typeof req.body.title === 'string' ? req.body.title.trim() : ''
      if (!val || val.length > 200) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อข้อบังคับ (ความยาวไม่เกิน 200 ตัวอักษร)' })
      }
      title = val
    }

    let body = existing.body
    if (req.body.body !== undefined) {
      const val = typeof req.body.body === 'string' ? req.body.body.trim() : null
      if (val && val.length > 5000) {
        return res.status(400).json({ success: false, message: 'รายละเอียดต้องมีความยาวไม่เกิน 5,000 ตัวอักษร' })
      }
      body = val || null
    }

    let announced_on = existing.announced_on
    if (req.body.announced_on !== undefined) {
      if (req.body.announced_on === null || req.body.announced_on === '') {
        announced_on = null
      } else {
        if (!isValidDate(req.body.announced_on)) {
          return res.status(400).json({ success: false, message: 'วันที่ประกาศไม่ถูกต้อง' })
        }
        announced_on = req.body.announced_on
      }
    }

    let is_active = existing.is_active
    if (req.body.is_active !== undefined) {
      is_active = req.body.is_active ? 1 : 0
    }

    db.prepare(`
      UPDATE hr_work_rules
      SET clause_no = ?, title = ?, body = ?, announced_on = ?, is_active = ?
      WHERE id = ? AND tenant_id = ?
    `).run(clause_no, title, body, announced_on, is_active, id, tenantId)

    const updated = db.prepare(`
      SELECT id, tenant_id, clause_no, title, body, announced_on, is_active, created_at
      FROM hr_work_rules WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId)

    res.json({ success: true, data: formatWorkRuleRow(updated) })
  } catch (err: any) {
    console.error('Update work rule error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// DELETE /work-rules/:id (hr:write, ลบ = is_active 0)
router.delete('/work-rules/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const id = req.params.id

    const existing = db.prepare(`
      SELECT id FROM hr_work_rules WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId)

    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อบังคับการทำงาน' })
    }

    db.prepare(`
      UPDATE hr_work_rules SET is_active = 0 WHERE id = ? AND tenant_id = ?
    `).run(id, tenantId)

    res.json({ success: true, data: { id, is_active: false } })
  } catch (err: any) {
    console.error('Delete work rule error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== บันทึกวินัย (hr_disciplinary_records) ====================

// GET /disciplinary?employee_id= (hr:read, แนบ active: boolean = วันนี้ <= expires_on, ชื่อพนักงาน, clause_no)
router.get('/disciplinary', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const employeeId = typeof req.query.employee_id === 'string' && req.query.employee_id.trim()
      ? req.query.employee_id.trim()
      : undefined

    const rows = db.prepare(`
      SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.code AS employee_code,
        w.clause_no,
        w.title AS work_rule_title,
        (SELECT COUNT(*) FROM payment_attachments a WHERE a.tenant_id = r.tenant_id AND a.ref_type = 'DISCIPLINARY_RECORD' AND a.ref_id = r.id) AS attachment_count
      FROM hr_disciplinary_records r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN hr_work_rules w ON w.id = r.work_rule_id AND w.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? ${employeeId ? 'AND r.employee_id = ?' : ''}
      ORDER BY r.incident_date DESC, r.created_at DESC
    `).all(...(employeeId ? [tenantId, employeeId] : [tenantId])) as any[]

    const today = thaiDateStr()
    res.json({ success: true, data: rows.map(r => formatDisciplinaryRow(r, today)) })
  } catch (err: any) {
    console.error('Get disciplinary records error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /disciplinary/:id (hr:read)
router.get('/disciplinary/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const row = db.prepare(`
      SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.code AS employee_code,
        w.clause_no,
        w.title AS work_rule_title,
        (SELECT COUNT(*) FROM payment_attachments a WHERE a.tenant_id = r.tenant_id AND a.ref_type = 'DISCIPLINARY_RECORD' AND a.ref_id = r.id) AS attachment_count
      FROM hr_disciplinary_records r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN hr_work_rules w ON w.id = r.work_rule_id AND w.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบบันทึกวินัย' })
    }

    const today = thaiDateStr()
    res.json({ success: true, data: formatDisciplinaryRow(row, today) })
  } catch (err: any) {
    console.error('Get disciplinary record error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// หนังสือเตือน/บันทึกตักเตือนเป็น PDF — ใช้ร่วมกันทั้งทาง HR และทางพนักงานเจ้าของบันทึก
async function sendDisciplinaryPdf(res: Response, tenantId: string, row: any) {
  const company = db.prepare('SELECT name FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  const companyName = company?.name || ''
  const empName = `${row.first_name || ''} ${row.last_name || ''}`.trim()
  const title = row.level === 'WRITTEN' ? 'หนังสือเตือนการกระทำผิดวินัย' : 'บันทึกการตักเตือนด้วยวาจา'

  const bodyParts: string[] = [
    `วันที่เกิดเหตุ: ${row.incident_date}`,
    `พนักงาน: ${empName} (รหัสพนักงาน: ${row.employee_code || '-'})`,
  ]
  if (row.position) bodyParts.push(`ตำแหน่ง: ${row.position}`)
  if (row.org_unit_name) bodyParts.push(`แผนก: ${row.org_unit_name}`)
  bodyParts.push(`หมวดหมู่ความผิด: ${row.category}`)
  if (row.clause_no) {
    bodyParts.push(`ข้อบังคับการทำงาน: ข้อที่ ${row.clause_no} ${row.work_rule_title ? `(${row.work_rule_title})` : ''}`.trim())
  }
  bodyParts.push(`ระดับการลงโทษ: ${row.level === 'WRITTEN' ? 'ตักเตือนเป็นหนังสือ' : 'ตักเตือนด้วยวาจา'}`)
  bodyParts.push(`วันหมดอายุผลทางวินัย: ${row.expires_on}`)
  bodyParts.push('')
  bodyParts.push('รายละเอียดการกระทำความผิด:')
  bodyParts.push(row.detail)

  const signatures: string[] = ['ผู้มีอำนาจลงนาม / ผู้บังคับบัญชา']
  if (empName) signatures.push(empName)
  if (row.witness_name) signatures.push(`พยาน (${row.witness_name})`)

  const buf = await renderPdf({
    title,
    companyName,
    bodyText: bodyParts.join('\n'),
    signatures,
  })

  const filename = `${title}_${row.employee_code || empName || row.id}`
  sendPdf(res, buf, filename)
}

// GET /disciplinary/:id/pdf (hr:read หรือเป็นเจ้าของบันทึก)
router.get('/disciplinary/:id/pdf', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId

    const row = db.prepare(`
      SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.code AS employee_code,
        e.position,
        o.name AS org_unit_name,
        w.clause_no,
        w.title AS work_rule_title
      FROM hr_disciplinary_records r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN org_units o ON o.id = e.org_unit_id AND o.tenant_id = e.tenant_id
      LEFT JOIN hr_work_rules w ON w.id = r.work_rule_id AND w.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบบันทึกวินัย' })
    }

    const hasHrRead = userHasHr(req, 'read')
    let isOwner = false
    if (!hasHrRead) {
      const self = getSelfEmployee(tenantId, userId)
      if (self && self.id === row.employee_id) {
        isOwner = true
      }
    }

    if (!hasHrRead && !isOwner) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    await sendDisciplinaryPdf(res, tenantId, row)
  } catch (err: any) {
    console.error('Download disciplinary pdf error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /disciplinary (hr:write)
// expires_on = incident_date + 1 ปี (ม.119) คำนวณจาก incident_date ฝั่งเซิร์ฟเวอร์เท่านั้น
// incident_date ในอนาคต -> 400, work_rule_id ต้องเป็นของบริษัทนี้
router.post('/disciplinary', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId

    const employeeId = typeof req.body.employee_id === 'string' ? req.body.employee_id.trim() : ''
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'กรุณาเลือกพนักงาน' })
    }

    const emp = db.prepare(`
      SELECT id FROM employees WHERE id = ? AND tenant_id = ?
    `).get(employeeId, tenantId)
    if (!emp) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
    }

    const incidentDate = req.body.incident_date
    if (!isValidDate(incidentDate)) {
      return res.status(400).json({ success: false, message: 'วันที่เกิดเหตุไม่ถูกต้อง' })
    }

    const today = thaiDateStr()
    if (incidentDate > today) {
      return res.status(400).json({ success: false, message: 'วันที่เกิดเหตุต้องไม่เป็นวันที่ในอนาคต' })
    }

    const category = typeof req.body.category === 'string' ? req.body.category.trim() : ''
    if (!category || category.length > 200) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุหมวดหมู่ความผิด (ความยาวไม่เกิน 200 ตัวอักษร)' })
    }

    const detail = typeof req.body.detail === 'string' ? req.body.detail.trim() : ''
    if (!detail || detail.length > 5000) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรายละเอียด (ความยาวไม่เกิน 5,000 ตัวอักษร)' })
    }

    const level = req.body.level
    if (level !== 'VERBAL' && level !== 'WRITTEN') {
      return res.status(400).json({ success: false, message: 'ระดับการลงโทษต้องเป็น VERBAL หรือ WRITTEN' })
    }

    let workRuleId: string | null = null
    if (req.body.work_rule_id) {
      const ruleId = typeof req.body.work_rule_id === 'string' ? req.body.work_rule_id.trim() : ''
      if (ruleId) {
        const rule = db.prepare(`
          SELECT id FROM hr_work_rules WHERE id = ? AND tenant_id = ?
        `).get(ruleId, tenantId)
        if (!rule) {
          return res.status(400).json({ success: false, message: 'ไม่พบข้อบังคับการทำงานที่ระบุ' })
        }
        workRuleId = ruleId
      }
    }

    // expires_on คำนวณจาก incident_date + 1 ปีเท่านั้น (ไม่รับจาก client)
    const expiresOn = computeDisciplinaryExpiresOn(incidentDate)

    const id = generateId()
    const createdBy = req.user!.userId
    const createdAt = new Date().toISOString()

    db.prepare(`
      INSERT INTO hr_disciplinary_records (
        id, tenant_id, employee_id, incident_date, category, detail,
        level, work_rule_id, expires_on, acknowledged_at, acknowledged_via,
        witness_name, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `).run(
      id,
      tenantId,
      employeeId,
      incidentDate,
      category,
      detail,
      level,
      workRuleId,
      expiresOn,
      createdBy,
      createdAt
    )

    const created = db.prepare(`
      SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.code AS employee_code,
        w.clause_no,
        w.title AS work_rule_title,
        0 AS attachment_count
      FROM hr_disciplinary_records r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN hr_work_rules w ON w.id = r.work_rule_id AND w.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ?
    `).get(id, tenantId) as any

    res.status(201).json({ success: true, data: formatDisciplinaryRow(created, today) })
  } catch (err: any) {
    console.error('Create disciplinary record error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// PUT /disciplinary/:id (hr:write) แก้ได้เฉพาะที่ยังไม่รับทราบ (รับทราบแล้ว -> 409) ไม่มี DELETE
router.put('/disciplinary/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const id = req.params.id

    const existing = db.prepare(`
      SELECT * FROM hr_disciplinary_records WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบบันทึกวินัย' })
    }

    if (existing.acknowledged_at !== null || existing.acknowledged_via !== null) {
      return res.status(409).json({ success: false, message: 'ไม่สามารถแก้ไขบันทึกที่รับทราบแล้ว' })
    }

    const today = thaiDateStr()
    let incidentDate = existing.incident_date
    let expiresOn = existing.expires_on

    if (req.body.incident_date !== undefined) {
      if (!isValidDate(req.body.incident_date)) {
        return res.status(400).json({ success: false, message: 'วันที่เกิดเหตุไม่ถูกต้อง' })
      }
      if (req.body.incident_date > today) {
        return res.status(400).json({ success: false, message: 'วันที่เกิดเหตุต้องไม่เป็นวันที่ในอนาคต' })
      }
      incidentDate = req.body.incident_date
      expiresOn = computeDisciplinaryExpiresOn(incidentDate)
    }

    let category = existing.category
    if (req.body.category !== undefined) {
      const val = typeof req.body.category === 'string' ? req.body.category.trim() : ''
      if (!val || val.length > 200) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุหมวดหมู่ความผิด (ความยาวไม่เกิน 200 ตัวอักษร)' })
      }
      category = val
    }

    let detail = existing.detail
    if (req.body.detail !== undefined) {
      const val = typeof req.body.detail === 'string' ? req.body.detail.trim() : ''
      if (!val || val.length > 5000) {
        return res.status(400).json({ success: false, message: 'กรุณาระบุรายละเอียด (ความยาวไม่เกิน 5,000 ตัวอักษร)' })
      }
      detail = val
    }

    let level = existing.level
    if (req.body.level !== undefined) {
      if (req.body.level !== 'VERBAL' && req.body.level !== 'WRITTEN') {
        return res.status(400).json({ success: false, message: 'ระดับการลงโทษต้องเป็น VERBAL หรือ WRITTEN' })
      }
      level = req.body.level
    }

    let workRuleId = existing.work_rule_id
    if (req.body.work_rule_id !== undefined) {
      if (req.body.work_rule_id === null || req.body.work_rule_id === '') {
        workRuleId = null
      } else {
        const ruleId = typeof req.body.work_rule_id === 'string' ? req.body.work_rule_id.trim() : ''
        const rule = db.prepare(`
          SELECT id FROM hr_work_rules WHERE id = ? AND tenant_id = ?
        `).get(ruleId, tenantId)
        if (!rule) {
          return res.status(400).json({ success: false, message: 'ไม่พบข้อบังคับการทำงานที่ระบุ' })
        }
        workRuleId = ruleId
      }
    }

    db.prepare(`
      UPDATE hr_disciplinary_records
      SET incident_date = ?, category = ?, detail = ?, level = ?, work_rule_id = ?, expires_on = ?
      WHERE id = ? AND tenant_id = ?
    `).run(incidentDate, category, detail, level, workRuleId, expiresOn, id, tenantId)

    const updated = db.prepare(`
      SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.code AS employee_code,
        w.clause_no,
        w.title AS work_rule_title,
        (SELECT COUNT(*) FROM payment_attachments a WHERE a.tenant_id = r.tenant_id AND a.ref_type = 'DISCIPLINARY_RECORD' AND a.ref_id = r.id) AS attachment_count
      FROM hr_disciplinary_records r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN hr_work_rules w ON w.id = r.work_rule_id AND w.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ?
    `).get(id, tenantId) as any

    res.json({ success: true, data: formatDisciplinaryRow(updated, today) })
  } catch (err: any) {
    console.error('Update disciplinary record error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /disciplinary/:id/acknowledge-witness body { witness_name } (hr:write -> via=WITNESS)
router.post('/disciplinary/:id/acknowledge-witness', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const id = req.params.id

    const existing = db.prepare(`
      SELECT * FROM hr_disciplinary_records WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId) as any

    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบบันทึกวินัย' })
    }

    if (existing.acknowledged_at !== null || existing.acknowledged_via !== null) {
      return res.status(409).json({ success: false, message: 'บันทึกนี้รับทราบแล้ว' })
    }

    const witnessName = typeof req.body.witness_name === 'string' ? req.body.witness_name.trim() : ''
    if (!witnessName || witnessName.length > 200) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อพยาน (ความยาวไม่เกิน 200 ตัวอักษร)' })
    }

    const acknowledgedAt = new Date().toISOString()
    db.prepare(`
      UPDATE hr_disciplinary_records
      SET acknowledged_at = ?, acknowledged_via = 'WITNESS', witness_name = ?
      WHERE id = ? AND tenant_id = ?
    `).run(acknowledgedAt, witnessName, id, tenantId)

    const updated = db.prepare(`
      SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.code AS employee_code,
        w.clause_no,
        w.title AS work_rule_title,
        (SELECT COUNT(*) FROM payment_attachments a WHERE a.tenant_id = r.tenant_id AND a.ref_type = 'DISCIPLINARY_RECORD' AND a.ref_id = r.id) AS attachment_count
      FROM hr_disciplinary_records r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN hr_work_rules w ON w.id = r.work_rule_id AND w.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ?
    `).get(id, tenantId) as any

    const today = thaiDateStr()
    res.json({ success: true, data: formatDisciplinaryRow(updated, today) })
  } catch (err: any) {
    console.error('Acknowledge disciplinary by witness error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== ส่วนของพนักงานตนเอง (/me/disciplinary) ====================

// GET /me/disciplinary -> ของตัวเอง (ไม่จำเป็นต้องมีสิทธิ์ hr)
router.get('/me/disciplinary', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId

    const self = getSelfEmployee(tenantId, userId)
    if (!self) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงานของผู้ใช้งาน' })
    }

    const rows = db.prepare(`
      SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.code AS employee_code,
        w.clause_no,
        w.title AS work_rule_title,
        (SELECT COUNT(*) FROM payment_attachments a WHERE a.tenant_id = r.tenant_id AND a.ref_type = 'DISCIPLINARY_RECORD' AND a.ref_id = r.id) AS attachment_count
      FROM hr_disciplinary_records r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN hr_work_rules w ON w.id = r.work_rule_id AND w.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.employee_id = ?
      ORDER BY r.incident_date DESC, r.created_at DESC
    `).all(tenantId, self.id) as any[]

    const today = thaiDateStr()
    res.json({ success: true, data: rows.map(r => formatDisciplinaryRow(r, today)) })
  } catch (err: any) {
    console.error('Get my disciplinary error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// POST /me/disciplinary/:id/acknowledge -> via=SELF เฉพาะของตัวเอง (ของคนอื่น -> 404, รับทราบซ้ำ -> 409)
router.post('/me/disciplinary/:id/acknowledge', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId

    const self = getSelfEmployee(tenantId, userId)
    if (!self) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงานของผู้ใช้งาน' })
    }

    const id = req.params.id
    const existing = db.prepare(`
      SELECT * FROM hr_disciplinary_records WHERE id = ? AND tenant_id = ?
    `).get(id, tenantId) as any

    // Disciplinary records are sensitive personal data: another employee id, even in the same company, answers 404
    if (!existing || existing.employee_id !== self.id) {
      return res.status(404).json({ success: false, message: 'ไม่พบบันทึกวินัย' })
    }

    if (existing.acknowledged_at !== null || existing.acknowledged_via !== null) {
      return res.status(409).json({ success: false, message: 'บันทึกนี้รับทราบแล้ว' })
    }

    const acknowledgedAt = new Date().toISOString()
    db.prepare(`
      UPDATE hr_disciplinary_records
      SET acknowledged_at = ?, acknowledged_via = 'SELF'
      WHERE id = ? AND tenant_id = ?
    `).run(acknowledgedAt, id, tenantId)

    const updated = db.prepare(`
      SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.code AS employee_code,
        w.clause_no,
        w.title AS work_rule_title,
        (SELECT COUNT(*) FROM payment_attachments a WHERE a.tenant_id = r.tenant_id AND a.ref_type = 'DISCIPLINARY_RECORD' AND a.ref_id = r.id) AS attachment_count
      FROM hr_disciplinary_records r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN hr_work_rules w ON w.id = r.work_rule_id AND w.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ?
    `).get(id, tenantId) as any

    const today = thaiDateStr()
    res.json({ success: true, data: formatDisciplinaryRow(updated, today) })
  } catch (err: any) {
    console.error('Acknowledge my disciplinary error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// GET /me/disciplinary/:id/pdf -> ดาวน์โหลดหนังสือเตือนของตัวเอง
router.get('/me/disciplinary/:id/pdf', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId

    const self = getSelfEmployee(tenantId, userId)
    if (!self) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงานของผู้ใช้งาน' })
    }

    const row = db.prepare(`
      SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.code AS employee_code,
        e.position,
        o.name AS org_unit_name,
        w.clause_no,
        w.title AS work_rule_title
      FROM hr_disciplinary_records r
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN org_units o ON o.id = e.org_unit_id AND o.tenant_id = e.tenant_id
      LEFT JOIN hr_work_rules w ON w.id = r.work_rule_id AND w.tenant_id = r.tenant_id
      WHERE r.id = ? AND r.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!row || row.employee_id !== self.id) {
      return res.status(404).json({ success: false, message: 'ไม่พบบันทึกวินัย' })
    }

    await sendDisciplinaryPdf(res, tenantId, row)
  } catch (err: any) {
    console.error('Download my disciplinary pdf error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
