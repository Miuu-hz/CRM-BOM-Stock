import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { can } from '../services/rbac.service'
import { renderPdf, sendPdf } from '../services/hr/pdf'

// HR Phase 10A — เอกสารพนักงาน + แม่แบบ (สัญญากลาง docs/contracts/hr-phase9-11.md)
const router = Router()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DOC_TYPES = ['CONTRACT', 'PROBATION', 'WORK_PERMIT', 'CERTIFICATE', 'OTHER']
const TEMPLATE_KINDS = ['CONTRACT', 'PROBATION', 'WARNING', 'CERTIFICATE']

function isValidDate(val: unknown): val is string {
  if (typeof val !== 'string' || !DATE_RE.test(val)) return false
  const d = new Date(`${val}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === val
}

function userHasHr(req: Request, action: 'read' | 'write'): boolean {
  if (!req.user) return false
  return can(req.user.role, req.user.departments || [], 'hr', action, req.user.customPermissions)
}

function deny(res: Response) {
  return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10)
}

function daysBetween(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split('-').map(Number)
  const [ty, tm, td] = toStr.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

const DOC_SELECT = `
  SELECT d.id, d.employee_id, e.code AS employee_code, e.first_name, e.last_name,
    d.doc_type, d.title, d.issued_on, d.expires_on, d.notes, d.created_at,
    (SELECT COUNT(*) FROM payment_attachments pa WHERE pa.tenant_id = d.tenant_id AND pa.ref_type = 'EMPLOYEE_DOCUMENT' AND pa.ref_id = d.id) AS attachment_count
  FROM hr_employee_documents d
  JOIN employees e ON e.id = d.employee_id AND e.tenant_id = d.tenant_id`

function formatDoc(r: any, today: string, withNotes = true) {
  const out: any = {
    id: r.id,
    employee_id: r.employee_id,
    employee_code: r.employee_code,
    employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    doc_type: r.doc_type,
    title: r.title,
    issued_on: r.issued_on ?? null,
    expires_on: r.expires_on ?? null,
    days_left: r.expires_on ? daysBetween(today, r.expires_on) : null,
    attachment_count: Number(r.attachment_count || 0),
    created_at: r.created_at,
  }
  if (withNotes) out.notes = r.notes ?? null
  return out
}

function optText(val: unknown, max: number): string | null | undefined {
  // undefined = invalid, null = empty
  if (val === undefined || val === null || val === '') return null
  if (typeof val !== 'string' || val.length > max) return undefined
  return val.trim() || null
}

function optDate(val: unknown): string | null | undefined {
  if (val === undefined || val === null || val === '') return null
  return isValidDate(val) ? val : undefined
}

function getDocRow(id: string, tenantId: string) {
  return db.prepare(`${DOC_SELECT} WHERE d.id = ? AND d.tenant_id = ?`).get(id, tenantId) as any
}

// ==================== เอกสารพนักงาน ====================

// ก่อน /documents/:id
router.get('/documents/expiring', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) return deny(res)
    let days = 60
    if (req.query.days !== undefined) {
      const d = Number(req.query.days)
      if (!Number.isInteger(d) || d < 1 || d > 365) {
        return res.status(400).json({ success: false, message: 'จำนวนวันต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 365' })
      }
      days = d
    }
    const today = thaiDateStr()
    const rows = db.prepare(`${DOC_SELECT}
      WHERE d.tenant_id = ? AND e.status = 'ACTIVE' AND d.expires_on IS NOT NULL AND d.expires_on <= ?
      ORDER BY d.expires_on ASC`).all(req.user!.tenantId, addDays(today, days)) as any[]
    res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id,
        employee_id: r.employee_id,
        employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        doc_type: r.doc_type,
        title: r.title,
        expires_on: r.expires_on,
        days_left: daysBetween(today, r.expires_on),
      })),
    })
  } catch (err: any) {
    console.error('Get expiring documents error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.get('/documents', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) return deny(res)
    const conds = ['d.tenant_id = ?']
    const params: any[] = [req.user!.tenantId]
    if (typeof req.query.employee_id === 'string' && req.query.employee_id.trim()) {
      conds.push('d.employee_id = ?')
      params.push(req.query.employee_id.trim())
    }
    if (req.query.doc_type !== undefined && req.query.doc_type !== '') {
      if (typeof req.query.doc_type !== 'string' || !DOC_TYPES.includes(req.query.doc_type)) {
        return res.status(400).json({ success: false, message: 'ประเภทเอกสารไม่ถูกต้อง' })
      }
      conds.push('d.doc_type = ?')
      params.push(req.query.doc_type)
    }
    const today = thaiDateStr()
    const rows = db.prepare(`${DOC_SELECT} WHERE ${conds.join(' AND ')} ORDER BY d.created_at DESC`).all(...params) as any[]
    res.json({ success: true, data: rows.map(r => formatDoc(r, today)) })
  } catch (err: any) {
    console.error('Get documents error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.post('/documents', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return deny(res)
    const tenantId = req.user!.tenantId
    const { employee_id, doc_type } = req.body
    if (typeof employee_id !== 'string' || !employee_id) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุพนักงาน' })
    }
    const emp = db.prepare('SELECT id, start_date FROM employees WHERE id = ? AND tenant_id = ?').get(employee_id, tenantId) as any
    if (!emp) return res.status(400).json({ success: false, message: 'ไม่พบพนักงาน' })
    if (!DOC_TYPES.includes(doc_type)) {
      return res.status(400).json({ success: false, message: 'ประเภทเอกสารไม่ถูกต้อง' })
    }
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
    if (!title || title.length > 200) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อเอกสาร (ไม่เกิน 200 ตัวอักษร)' })
    }
    const issuedOn = optDate(req.body.issued_on)
    if (issuedOn === undefined) return res.status(400).json({ success: false, message: 'วันที่ออกเอกสารไม่ถูกต้อง' })
    let expiresOn = optDate(req.body.expires_on)
    if (expiresOn === undefined) return res.status(400).json({ success: false, message: 'วันหมดอายุไม่ถูกต้อง' })
    if (doc_type === 'PROBATION' && req.body.expires_on === undefined && isValidDate(emp.start_date)) {
      expiresOn = addDays(emp.start_date, 119)
    }
    const notes = optText(req.body.notes, 5000)
    if (notes === undefined) return res.status(400).json({ success: false, message: 'หมายเหตุยาวเกินไป' })

    const id = generateId()
    db.prepare(`INSERT INTO hr_employee_documents
      (id, tenant_id, employee_id, doc_type, title, issued_on, expires_on, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, tenantId, employee_id, doc_type, title, issuedOn, expiresOn, notes, req.user!.userId, new Date().toISOString())
    res.status(201).json({ success: true, data: formatDoc(getDocRow(id, tenantId), thaiDateStr()) })
  } catch (err: any) {
    console.error('Create document error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.put('/documents/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return deny(res)
    const tenantId = req.user!.tenantId
    const ex = db.prepare('SELECT * FROM hr_employee_documents WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ex) return res.status(404).json({ success: false, message: 'ไม่พบเอกสาร' })

    let docType = ex.doc_type
    if (req.body.doc_type !== undefined) {
      if (!DOC_TYPES.includes(req.body.doc_type)) return res.status(400).json({ success: false, message: 'ประเภทเอกสารไม่ถูกต้อง' })
      docType = req.body.doc_type
    }
    let title = ex.title
    if (req.body.title !== undefined) {
      title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
      if (!title || title.length > 200) return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อเอกสาร (ไม่เกิน 200 ตัวอักษร)' })
    }
    let issuedOn = ex.issued_on
    if (req.body.issued_on !== undefined) {
      issuedOn = optDate(req.body.issued_on)
      if (issuedOn === undefined) return res.status(400).json({ success: false, message: 'วันที่ออกเอกสารไม่ถูกต้อง' })
    }
    let expiresOn = ex.expires_on
    if (req.body.expires_on !== undefined) {
      expiresOn = optDate(req.body.expires_on)
      if (expiresOn === undefined) return res.status(400).json({ success: false, message: 'วันหมดอายุไม่ถูกต้อง' })
    }
    let notes = ex.notes
    if (req.body.notes !== undefined) {
      notes = optText(req.body.notes, 5000)
      if (notes === undefined) return res.status(400).json({ success: false, message: 'หมายเหตุยาวเกินไป' })
    }
    db.prepare(`UPDATE hr_employee_documents SET doc_type = ?, title = ?, issued_on = ?, expires_on = ?, notes = ?
      WHERE id = ? AND tenant_id = ?`).run(docType, title, issuedOn, expiresOn, notes, ex.id, tenantId)
    res.json({ success: true, data: formatDoc(getDocRow(ex.id, tenantId), thaiDateStr()) })
  } catch (err: any) {
    console.error('Update document error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.delete('/documents/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return deny(res)
    const tenantId = req.user!.tenantId
    const ex = db.prepare('SELECT id FROM hr_employee_documents WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ex) return res.status(404).json({ success: false, message: 'ไม่พบเอกสาร' })
    const cnt = (db.prepare(`SELECT COUNT(*) AS count FROM payment_attachments
      WHERE tenant_id = ? AND ref_type = 'EMPLOYEE_DOCUMENT' AND ref_id = ?`).get(tenantId, ex.id) as any)?.count || 0
    if (cnt > 0) return res.status(409).json({ success: false, message: 'ลบไฟล์แนบก่อน' })
    db.prepare('DELETE FROM hr_employee_documents WHERE id = ? AND tenant_id = ?').run(ex.id, tenantId)
    res.json({ success: true, data: { id: ex.id } })
  } catch (err: any) {
    console.error('Delete document error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== แม่แบบเอกสาร ====================

function parseTemplate(body: any, existing?: any): { error: string } | { kind: string; name: string; body: string } {
  const kind = body.kind !== undefined ? body.kind : existing?.kind
  if (!TEMPLATE_KINDS.includes(kind)) return { error: 'ประเภทแม่แบบไม่ถูกต้อง' }
  const name = body.name !== undefined ? (typeof body.name === 'string' ? body.name.trim() : '') : existing?.name
  if (!name || name.length > 200) return { error: 'กรุณาระบุชื่อแม่แบบ (ไม่เกิน 200 ตัวอักษร)' }
  const text = body.body !== undefined ? body.body : existing?.body ?? ''
  if (typeof text !== 'string' || text.length > 20000) return { error: 'เนื้อหาแม่แบบต้องไม่เกิน 20000 ตัวอักษร' }
  return { kind, name, body: text }
}

router.get('/doc-templates', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) return deny(res)
    const rows = db.prepare(`SELECT id, kind, name, body, created_at, updated_at FROM hr_doc_templates
      WHERE tenant_id = ? ORDER BY kind, name`).all(req.user!.tenantId)
    res.json({ success: true, data: rows })
  } catch (err: any) {
    console.error('Get doc templates error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.post('/doc-templates', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return deny(res)
    const p = parseTemplate(req.body || {})
    if ('error' in p) return res.status(400).json({ success: false, message: p.error })
    const id = generateId()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO hr_doc_templates (id, tenant_id, kind, name, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, req.user!.tenantId, p.kind, p.name, p.body, now, now)
    res.status(201).json({ success: true, data: { id, ...p, created_at: now, updated_at: now } })
  } catch (err: any) {
    console.error('Create doc template error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.put('/doc-templates/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return deny(res)
    const tenantId = req.user!.tenantId
    const ex = db.prepare('SELECT * FROM hr_doc_templates WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!ex) return res.status(404).json({ success: false, message: 'ไม่พบแม่แบบ' })
    const p = parseTemplate(req.body || {}, ex)
    if ('error' in p) return res.status(400).json({ success: false, message: p.error })
    const now = new Date().toISOString()
    db.prepare('UPDATE hr_doc_templates SET kind = ?, name = ?, body = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
      .run(p.kind, p.name, p.body, now, ex.id, tenantId)
    res.json({ success: true, data: { id: ex.id, ...p, created_at: ex.created_at, updated_at: now } })
  } catch (err: any) {
    console.error('Update doc template error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.delete('/doc-templates/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return deny(res)
    const r = db.prepare('DELETE FROM hr_doc_templates WHERE id = ? AND tenant_id = ?').run(req.params.id, req.user!.tenantId)
    if (r.changes === 0) return res.status(404).json({ success: false, message: 'ไม่พบแม่แบบ' })
    res.json({ success: true, data: { id: req.params.id } })
  } catch (err: any) {
    console.error('Delete doc template error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export interface RenderDocTemplateResult {
  text: string
  templateName: string
  companyName: string
  employeeName: string
}

export function renderDocTemplate(
  tenantId: string,
  templateId: string,
  employeeId: unknown,
  extra: unknown
): { error: { status: number; message: string } } | { data: RenderDocTemplateResult } {
  const tpl = db.prepare('SELECT name, body FROM hr_doc_templates WHERE id = ? AND tenant_id = ?').get(templateId, tenantId) as any
  if (!tpl) return { error: { status: 404, message: 'ไม่พบแม่แบบ' } }
  if (typeof employeeId !== 'string' || !employeeId) {
    return { error: { status: 400, message: 'กรุณาระบุพนักงาน' } }
  }
  const emp = db.prepare(`SELECT e.*, o.name AS org_unit_name FROM employees e
    LEFT JOIN org_units o ON o.id = e.org_unit_id AND o.tenant_id = e.tenant_id
    WHERE e.id = ? AND e.tenant_id = ?`).get(employeeId, tenantId) as any
  if (!emp) return { error: { status: 404, message: 'ไม่พบพนักงาน' } }

  const vals = new Map<string, string>()
  if (extra !== undefined && extra !== null) {
    if (typeof extra !== 'object' || Array.isArray(extra) || Object.keys(extra as any).length > 50) {
      return { error: { status: 400, message: 'ข้อมูลเพิ่มเติมไม่ถูกต้อง' } }
    }
    for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
      if (!/^\w{1,50}$/.test(k) || typeof v !== 'string' || v.length > 5000) {
        return { error: { status: 400, message: 'ข้อมูลเพิ่มเติมไม่ถูกต้อง' } }
      }
      vals.set(k, v)
    }
  }
  const company = db.prepare('SELECT name FROM company_settings WHERE tenant_id = ?').get(tenantId) as any
  const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim()
  const companyName = company?.name || ''
  // ค่าระบบทับ extra เพื่อไม่ให้ปลอมข้อมูลพนักงาน
  const builtin: Record<string, string> = {
    company_name: companyName,
    employee_name: empName,
    employee_code: emp.code || '',
    position: emp.position || '',
    org_unit: emp.org_unit_name || '',
    start_date: emp.start_date || '',
    base_wage: Number(emp.base_wage || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    national_id: emp.national_id || '',
    today: thaiDateStr(),
  }
  for (const [k, v] of Object.entries(builtin)) vals.set(k, v)

  const text = tpl.body.replace(/\{\{(\w+)\}\}/g, (m: string, k: string) => (vals.has(k) ? vals.get(k)! : m))
  return {
    data: {
      text,
      templateName: tpl.name || '',
      companyName,
      employeeName: empName,
    },
  }
}

// plain text เท่านั้น: แทนที่ {{key}} รอบเดียว (ค่าที่แทนแล้วไม่ถูกแทนซ้ำ) และไม่ตีความ HTML
router.post('/doc-templates/:id/render', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return deny(res)
    const result = renderDocTemplate(req.user!.tenantId, req.params.id, req.body?.employee_id, req.body?.extra)
    if ('error' in result) {
      return res.status(result.error.status).json({ success: false, message: result.error.message })
    }
    res.json({ success: true, data: { text: result.data.text } })
  } catch (err: any) {
    console.error('Render doc template error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

router.get('/doc-templates/:id/pdf', async (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) return deny(res)
    const tenantId = req.user!.tenantId
    let extra: any = undefined
    if (typeof req.query.extra === 'string') {
      try { extra = JSON.parse(req.query.extra) } catch { /* ignore */ }
    }
    const result = renderDocTemplate(tenantId, req.params.id, req.query.employee_id, extra)
    if ('error' in result) {
      return res.status(result.error.status).json({ success: false, message: result.error.message })
    }
    const buf = await renderPdf({
      title: result.data.templateName,
      companyName: result.data.companyName,
      bodyText: result.data.text,
      signatures: result.data.employeeName ? [result.data.employeeName] : [],
    })
    sendPdf(res, buf, result.data.templateName || 'document')
  } catch (err: any) {
    console.error('Download doc template pdf error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== เอกสารของฉัน ====================

router.get('/me/documents', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const self = db.prepare(`SELECT id FROM employees WHERE tenant_id = ? AND user_id = ? AND status = 'ACTIVE'`)
      .get(tenantId, req.user!.userId) as any
    if (!self) return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    const rows = db.prepare(`${DOC_SELECT} WHERE d.tenant_id = ? AND d.employee_id = ? ORDER BY d.created_at DESC`)
      .all(tenantId, self.id) as any[]
    const today = thaiDateStr()
    res.json({ success: true, data: rows.map(r => formatDoc(r, today, false)) })
  } catch (err: any) {
    console.error('Get my documents error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
