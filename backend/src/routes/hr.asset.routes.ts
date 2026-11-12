import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { can } from '../services/rbac.service'

// สัญญากลาง: docs/contracts/hr-phase9-11.md — Phase 9B ทรัพย์สินที่ให้ยืม
const router = Router()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDate(val: unknown): val is string {
  if (typeof val !== 'string' || !DATE_RE.test(val)) return false
  const d = new Date(`${val}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === val
}

function isUniqueConstraintError(err: any): boolean {
  return (
    err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    String(err?.message || '').includes('UNIQUE constraint failed')
  )
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

function formatAssetRow(r: any) {
  const current_loan = r.loan_id
    ? {
        loan_id: r.loan_id,
        employee_id: r.employee_id,
        employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        loaned_on: r.loaned_on,
      }
    : null

  return {
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category ?? null,
    status: r.status,
    notes: r.notes ?? null,
    created_at: r.created_at,
    current_loan,
  }
}

function formatLoanRow(r: any) {
  return {
    id: r.id,
    asset_id: r.asset_id,
    asset_code: r.asset_code ?? '',
    asset_name: r.asset_name ?? '',
    asset_category: r.asset_category ?? null,
    employee_id: r.employee_id,
    employee_code: r.employee_code ?? '',
    employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    loaned_on: r.loaned_on,
    returned_on: r.returned_on ?? null,
    note: r.note ?? null,
    attachment_count: Number(r.attachment_count || 0),
    created_by: r.created_by ?? null,
    created_at: r.created_at,
  }
}

// ==================== 1. GET /assets (hr:read) ====================
router.get('/assets', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : ''
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

    const conditions: string[] = ['a.tenant_id = ?']
    const params: any[] = [tenantId]

    if (status && ['AVAILABLE', 'LOANED', 'RETIRED'].includes(status)) {
      conditions.push('a.status = ?')
      params.push(status)
    }

    if (q) {
      conditions.push('(a.code LIKE ? OR a.name LIKE ?)')
      params.push(`%${q}%`, `%${q}%`)
    }

    const whereClause = conditions.join(' AND ')

    const rows = db.prepare(`
      SELECT
        a.id, a.code, a.name, a.category, a.status, a.notes, a.created_at,
        l.id AS loan_id, l.employee_id,
        e.first_name, e.last_name,
        l.loaned_on
      FROM hr_assets a
      LEFT JOIN hr_asset_loans l ON l.asset_id = a.id AND l.tenant_id = a.tenant_id AND l.returned_on IS NULL
      LEFT JOIN employees e ON e.id = l.employee_id AND e.tenant_id = a.tenant_id
      WHERE ${whereClause}
      ORDER BY a.code ASC
    `).all(...params) as any[]

    res.json({ success: true, data: rows.map(formatAssetRow) })
  } catch (err: any) {
    console.error('Get assets error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== 2. POST /assets (hr:write) ====================
router.post('/assets', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const code = typeof req.body.code === 'string' ? req.body.code.trim() : ''
    if (!code) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสทรัพย์สิน' })
    }
    if (code.length > 200) {
      return res.status(400).json({ success: false, message: 'รหัสทรัพย์สินต้องไม่เกิน 200 ตัวอักษร' })
    }

    const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
    if (!name) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อทรัพย์สิน' })
    }
    if (name.length > 200) {
      return res.status(400).json({ success: false, message: 'ชื่อทรัพย์สินต้องไม่เกิน 200 ตัวอักษร' })
    }

    let category: string | null = null
    if (req.body.category !== undefined && req.body.category !== null) {
      const cat = String(req.body.category).trim()
      if (cat.length > 200) {
        return res.status(400).json({ success: false, message: 'หมวดหมู่ต้องไม่เกิน 200 ตัวอักษร' })
      }
      category = cat || null
    }

    let notes: string | null = null
    if (req.body.notes !== undefined && req.body.notes !== null) {
      const n = String(req.body.notes).trim()
      if (n.length > 5000) {
        return res.status(400).json({ success: false, message: 'หมายเหตุต้องไม่เกิน 5000 ตัวอักษร' })
      }
      notes = n || null
    }

    const tenantId = req.user!.tenantId
    const id = generateId()
    const now = new Date().toISOString()

    try {
      db.prepare(`
        INSERT INTO hr_assets (id, tenant_id, code, name, category, status, notes, created_at)
        VALUES (?, ?, ?, ?, ?, 'AVAILABLE', ?, ?)
      `).run(id, tenantId, code, name, category, notes, now)
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        return res.status(409).json({ success: false, message: 'มีรหัสทรัพย์สินนี้แล้ว' })
      }
      throw err
    }

    res.status(201).json({
      success: true,
      data: {
        id,
        code,
        name,
        category,
        status: 'AVAILABLE',
        notes,
        created_at: now,
        current_loan: null,
      },
    })
  } catch (err: any) {
    console.error('Create asset error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== 3. GET /me/asset-loans (self) ====================
// Note: Placed before /assets/:id to ensure clean routing
router.get('/me/asset-loans', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)

    if (!selfEmp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const rows = db.prepare(`
      SELECT
        l.id, l.asset_id, a.code AS asset_code, a.name AS asset_name, a.category AS asset_category,
        l.employee_id, e.code AS employee_code, e.first_name, e.last_name,
        l.loaned_on, l.returned_on, l.note, l.created_by, l.created_at,
        (SELECT COUNT(*) FROM payment_attachments pa WHERE pa.tenant_id = l.tenant_id AND pa.ref_type = 'ASSET_LOAN' AND pa.ref_id = l.id) AS attachment_count
      FROM hr_asset_loans l
      JOIN hr_assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
      JOIN employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.employee_id = ?
      ORDER BY l.loaned_on DESC, l.created_at DESC
    `).all(tenantId, selfEmp.id) as any[]

    res.json({ success: true, data: rows.map(formatLoanRow) })
  } catch (err: any) {
    console.error('Get my asset loans error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== 4. GET /employees/:id/asset-loans (hr:read) ====================
router.get('/employees/:id/asset-loans', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const employeeId = req.params.id

    const emp = db.prepare('SELECT id FROM employees WHERE id = ? AND tenant_id = ?').get(employeeId, tenantId)
    if (!emp) {
      return res.status(404).json({ success: false, message: 'ไม่พบพนักงาน' })
    }

    const rows = db.prepare(`
      SELECT
        l.id, l.asset_id, a.code AS asset_code, a.name AS asset_name, a.category AS asset_category,
        l.employee_id, e.code AS employee_code, e.first_name, e.last_name,
        l.loaned_on, l.returned_on, l.note, l.created_by, l.created_at,
        (SELECT COUNT(*) FROM payment_attachments pa WHERE pa.tenant_id = l.tenant_id AND pa.ref_type = 'ASSET_LOAN' AND pa.ref_id = l.id) AS attachment_count
      FROM hr_asset_loans l
      JOIN hr_assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
      JOIN employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.employee_id = ?
      ORDER BY l.loaned_on DESC, l.created_at DESC
    `).all(tenantId, employeeId) as any[]

    res.json({ success: true, data: rows.map(formatLoanRow) })
  } catch (err: any) {
    console.error('Get employee asset loans error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== 5. POST /asset-loans/:id/return (hr:write) ====================
router.post('/asset-loans/:id/return', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const loanId = req.params.id

    const returnedOn = req.body.returned_on
    if (!isValidDate(returnedOn)) {
      return res.status(400).json({ success: false, message: 'วันที่คืนไม่ถูกต้อง' })
    }

    const loan = db.prepare('SELECT * FROM hr_asset_loans WHERE id = ? AND tenant_id = ?').get(loanId, tenantId) as any
    if (!loan) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการยืมทรัพย์สิน' })
    }

    if (loan.returned_on !== null) {
      return res.status(409).json({ success: false, message: 'ทรัพย์สินนี้ถูกบันทึกรับคืนแล้ว' })
    }

    if (returnedOn < loan.loaned_on) {
      return res.status(400).json({ success: false, message: 'วันที่คืนต้องไม่ก่อนวันที่ยืม' })
    }

    try {
      const runTx = db.transaction(() => {
        const curLoan = db.prepare('SELECT * FROM hr_asset_loans WHERE id = ? AND tenant_id = ?').get(loanId, tenantId) as any
        if (!curLoan) {
          const err: any = new Error('ไม่พบรายการยืมทรัพย์สิน')
          err.statusCode = 404
          throw err
        }
        if (curLoan.returned_on !== null) {
          const err: any = new Error('ทรัพย์สินนี้ถูกบันทึกรับคืนแล้ว')
          err.statusCode = 409
          throw err
        }
        if (returnedOn < curLoan.loaned_on) {
          const err: any = new Error('วันที่คืนต้องไม่ก่อนวันที่ยืม')
          err.statusCode = 400
          throw err
        }

        db.prepare('UPDATE hr_asset_loans SET returned_on = ? WHERE id = ? AND tenant_id = ?').run(returnedOn, loanId, tenantId)
        db.prepare("UPDATE hr_assets SET status = 'AVAILABLE' WHERE id = ? AND tenant_id = ?").run(curLoan.asset_id, tenantId)
      })
      runTx()
    } catch (err: any) {
      if (err?.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message })
      }
      throw err
    }

    res.json({
      success: true,
      data: {
        id: loan.id,
        asset_id: loan.asset_id,
        employee_id: loan.employee_id,
        loaned_on: loan.loaned_on,
        returned_on: returnedOn,
        note: loan.note,
        created_by: loan.created_by,
        created_at: loan.created_at,
      },
    })
  } catch (err: any) {
    console.error('Return asset loan error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== 6. GET /assets/:id (hr:read) ====================
router.get('/assets/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const row = db.prepare(`
      SELECT
        a.id, a.code, a.name, a.category, a.status, a.notes, a.created_at,
        l.id AS loan_id, l.employee_id,
        e.first_name, e.last_name,
        l.loaned_on
      FROM hr_assets a
      LEFT JOIN hr_asset_loans l ON l.asset_id = a.id AND l.tenant_id = a.tenant_id AND l.returned_on IS NULL
      LEFT JOIN employees e ON e.id = l.employee_id AND e.tenant_id = a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบทรัพย์สิน' })
    }

    res.json({ success: true, data: formatAssetRow(row) })
  } catch (err: any) {
    console.error('Get asset error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== 7. GET /assets/:id/loans (hr:read) ====================
router.get('/assets/:id/loans', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const asset = db.prepare('SELECT id FROM hr_assets WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    if (!asset) {
      return res.status(404).json({ success: false, message: 'ไม่พบทรัพย์สิน' })
    }

    const rows = db.prepare(`
      SELECT
        l.id, l.asset_id, a.code AS asset_code, a.name AS asset_name, a.category AS asset_category,
        l.employee_id, e.code AS employee_code, e.first_name, e.last_name,
        l.loaned_on, l.returned_on, l.note, l.created_by, l.created_at,
        (SELECT COUNT(*) FROM payment_attachments pa WHERE pa.tenant_id = l.tenant_id AND pa.ref_type = 'ASSET_LOAN' AND pa.ref_id = l.id) AS attachment_count
      FROM hr_asset_loans l
      JOIN hr_assets a ON a.id = l.asset_id AND a.tenant_id = l.tenant_id
      JOIN employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND l.asset_id = ?
      ORDER BY l.loaned_on DESC, l.created_at DESC
    `).all(tenantId, req.params.id) as any[]

    res.json({ success: true, data: rows.map(formatLoanRow) })
  } catch (err: any) {
    console.error('Get asset loans error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== 8. PUT /assets/:id (hr:write) ====================
router.put('/assets/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const existing = db.prepare('SELECT * FROM hr_assets WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบทรัพย์สิน' })
    }

    let newCode = existing.code
    if (req.body.code !== undefined) {
      if (typeof req.body.code !== 'string' || !req.body.code.trim()) {
        return res.status(400).json({ success: false, message: 'รหัสทรัพย์สินต้องไม่ว่างเปล่า' })
      }
      const c = req.body.code.trim()
      if (c.length > 200) {
        return res.status(400).json({ success: false, message: 'รหัสทรัพย์สินต้องไม่เกิน 200 ตัวอักษร' })
      }
      newCode = c
    }

    let newName = existing.name
    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
        return res.status(400).json({ success: false, message: 'ชื่อทรัพย์สินต้องไม่ว่างเปล่า' })
      }
      const n = req.body.name.trim()
      if (n.length > 200) {
        return res.status(400).json({ success: false, message: 'ชื่อทรัพย์สินต้องไม่เกิน 200 ตัวอักษร' })
      }
      newName = n
    }

    let newCategory = existing.category
    if (req.body.category !== undefined) {
      if (req.body.category === null || req.body.category === '') {
        newCategory = null
      } else {
        const cat = String(req.body.category).trim()
        if (cat.length > 200) {
          return res.status(400).json({ success: false, message: 'หมวดหมู่ต้องไม่เกิน 200 ตัวอักษร' })
        }
        newCategory = cat || null
      }
    }

    let newNotes = existing.notes
    if (req.body.notes !== undefined) {
      if (req.body.notes === null || req.body.notes === '') {
        newNotes = null
      } else {
        const n = String(req.body.notes).trim()
        if (n.length > 5000) {
          return res.status(400).json({ success: false, message: 'หมายเหตุต้องไม่เกิน 5000 ตัวอักษร' })
        }
        newNotes = n || null
      }
    }

    let newStatus = existing.status
    if (req.body.status !== undefined) {
      if (!['AVAILABLE', 'LOANED', 'RETIRED'].includes(req.body.status)) {
        return res.status(400).json({ success: false, message: 'สถานะไม่ถูกต้อง' })
      }
      newStatus = req.body.status
      // Contract: ตั้ง RETIRED ขณะ LOANED → 409
      if (newStatus === 'RETIRED' && existing.status === 'LOANED') {
        return res.status(409).json({ success: false, message: 'ไม่สามารถตัดจำหน่ายทรัพย์สินที่อยู่ระหว่างการยืมได้' })
      }
      if (existing.status === 'LOANED' && newStatus === 'AVAILABLE') {
        const openLoan = db.prepare('SELECT id FROM hr_asset_loans WHERE asset_id = ? AND tenant_id = ? AND returned_on IS NULL').get(existing.id, tenantId)
        if (openLoan) {
          return res.status(409).json({ success: false, message: 'ทรัพย์สินอยู่ระหว่างการยืม ต้องบันทึกรับคืนก่อนเปลี่ยนสถานะ' })
        }
      }
      if (existing.status !== 'LOANED' && newStatus === 'LOANED') {
        return res.status(400).json({ success: false, message: 'การให้ยืมต้องทำผ่านการบันทึกให้ยืมทรัพย์สิน' })
      }
    }

    try {
      db.prepare(`
        UPDATE hr_assets
        SET code = ?, name = ?, category = ?, status = ?, notes = ?
        WHERE id = ? AND tenant_id = ?
      `).run(newCode, newName, newCategory, newStatus, newNotes, existing.id, tenantId)
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        return res.status(409).json({ success: false, message: 'มีรหัสทรัพย์สินนี้แล้ว' })
      }
      throw err
    }

    const row = db.prepare(`
      SELECT
        a.id, a.code, a.name, a.category, a.status, a.notes, a.created_at,
        l.id AS loan_id, l.employee_id,
        e.first_name, e.last_name,
        l.loaned_on
      FROM hr_assets a
      LEFT JOIN hr_asset_loans l ON l.asset_id = a.id AND l.tenant_id = a.tenant_id AND l.returned_on IS NULL
      LEFT JOIN employees e ON e.id = l.employee_id AND e.tenant_id = a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?
    `).get(existing.id, tenantId) as any

    res.json({ success: true, data: formatAssetRow(row) })
  } catch (err: any) {
    console.error('Update asset error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ==================== 9. POST /assets/:id/loan (hr:write) ====================
router.post('/assets/:id/loan', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const assetId = req.params.id

    const asset = db.prepare('SELECT * FROM hr_assets WHERE id = ? AND tenant_id = ?').get(assetId, tenantId) as any
    if (!asset) {
      return res.status(404).json({ success: false, message: 'ไม่พบทรัพย์สิน' })
    }

    if (asset.status !== 'AVAILABLE') {
      return res.status(409).json({ success: false, message: 'ทรัพย์สินนี้ไม่พร้อมให้ยืม' })
    }

    const employeeId = typeof req.body.employee_id === 'string' ? req.body.employee_id.trim() : ''
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุพนักงานที่ยืม' })
    }

    const loanedOn = req.body.loaned_on
    if (!isValidDate(loanedOn)) {
      return res.status(400).json({ success: false, message: 'วันที่ยืมไม่ถูกต้อง' })
    }

    let note: string | null = null
    if (req.body.note !== undefined && req.body.note !== null) {
      const n = String(req.body.note).trim()
      if (n.length > 5000) {
        return res.status(400).json({ success: false, message: 'หมายเหตุต้องไม่เกิน 5000 ตัวอักษร' })
      }
      note = n || null
    }

    const emp = db.prepare('SELECT id, first_name, last_name, status FROM employees WHERE id = ? AND tenant_id = ?').get(employeeId, tenantId) as any
    if (!emp || emp.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'ไม่พบพนักงาน หรือพนักงานไม่อยู่ในสถานะทำงาน' })
    }

    const loanId = generateId()
    const now = new Date().toISOString()
    const createdBy = req.user!.userId

    try {
      const runTx = db.transaction(() => {
        const cur = db.prepare('SELECT status FROM hr_assets WHERE id = ? AND tenant_id = ?').get(assetId, tenantId) as any
        if (!cur || cur.status !== 'AVAILABLE') {
          const err: any = new Error('ทรัพย์สินนี้ไม่พร้อมให้ยืม')
          err.statusCode = 409
          throw err
        }

        db.prepare(`UPDATE hr_assets SET status = 'LOANED' WHERE id = ? AND tenant_id = ?`).run(assetId, tenantId)

        db.prepare(`
          INSERT INTO hr_asset_loans (id, tenant_id, asset_id, employee_id, loaned_on, returned_on, note, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
        `).run(loanId, tenantId, assetId, employeeId, loanedOn, note, createdBy, now)
      })
      runTx()
    } catch (err: any) {
      if (err?.statusCode === 409 || isUniqueConstraintError(err)) {
        return res.status(409).json({ success: false, message: 'ทรัพย์สินนี้ไม่พร้อมให้ยืม' })
      }
      throw err
    }

    res.status(201).json({
      success: true,
      data: {
        id: loanId,
        asset_id: assetId,
        employee_id: employeeId,
        employee_name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(),
        loaned_on: loanedOn,
        returned_on: null,
        note,
        created_by: createdBy,
        created_at: now,
      },
    })
  } catch (err: any) {
    console.error('Loan asset error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
