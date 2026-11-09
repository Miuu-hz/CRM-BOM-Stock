import { Router, Request, Response } from 'express'
import db from '../db/sqlite'
import { generateId, thaiDateStr } from '../utils/id'
import { can } from '../services/rbac.service'
import { createRequest } from '../services/approvalGate.service'
import { ACC } from '../config/accountCodes'
import { getOrCreateAccount, isHeaderAccountError } from '../services/accounting.service'
import { round2 } from '../services/hr/payrollCalc'
import { insertJournalEntry, closedPeriodLabel, JournalLineInput } from './journal.routes'
import { advanceOutstanding, interestPortion, getTenantHrSettings } from './hr.payroll.routes'

// สัญญากลาง: docs/contracts/hr-phase5-6.md — เบิกล่วงหน้า / เงินยืม (งาน B6)
const router = Router()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

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

const ADVANCE_SELECT = `
  SELECT a.*, e.code AS employee_code, e.first_name, e.last_name,
         COALESCE((SELECT SUM(r.amount) FROM advance_repayments r WHERE r.advance_id = a.id AND r.tenant_id = a.tenant_id), 0) AS repaid
  FROM employee_advances a
  JOIN employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
`

function formatAdvance(tenantId: string, r: any) {
  const amount = round2(Number(r.amount))
  const interest_rate = round2(Number(r.interest_rate ?? 0))
  const interest_amount = round2(Number(r.interest_amount ?? 0))
  const repaid = round2(Number(r.repaid ?? 0))
  const outstanding = advanceOutstanding(tenantId, r.id)
  return {
    id: r.id,
    employee_id: r.employee_id,
    employee_code: r.employee_code,
    employee_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
    kind: r.kind as 'ADVANCE' | 'LOAN',
    amount,
    installments: Number(r.installments),
    installment_amount: round2(Number(r.installment_amount)),
    interest_rate,
    interest_amount,
    start_period: r.start_period,
    reason: r.reason ?? null,
    status: r.status,
    approval_request_id: r.approval_request_id ?? null,
    decided_at: r.decided_at ?? null,
    disbursed_on: r.disbursed_on ?? null,
    disburse_je_id: r.disburse_je_id ?? null,
    repaid,
    outstanding,
    created_at: r.created_at,
  }
}

function getAdvanceById(tenantId: string, id: string) {
  const row = db.prepare(`${ADVANCE_SELECT} WHERE a.id = ? AND a.tenant_id = ?`).get(id, tenantId) as any
  return row ? formatAdvance(tenantId, row) : null
}

function getAdvanceDetail(tenantId: string, id: string) {
  const adv = getAdvanceById(tenantId, id)
  if (!adv) return null
  const repayments = (
    db.prepare(`
      SELECT run_id, period, amount, interest, source, created_at
      FROM advance_repayments
      WHERE tenant_id = ? AND advance_id = ?
      ORDER BY period ASC, created_at ASC
    `).all(tenantId, adv.id) as any[]
  ).map((r) => ({
    run_id: r.run_id,
    period: r.period,
    amount: round2(Number(r.amount)),
    interest: round2(Number(r.interest ?? 0)),
    source: (r.source === 'CASH' ? 'CASH' : 'PAYROLL') as 'PAYROLL' | 'CASH',
    created_at: r.created_at,
  }))
  return { ...adv, repayments }
}

function validateDateAndAssetAccount(
  tenantId: string,
  body: any
): { ok: true; date: string; payAccountId: string } | { ok: false; message: string } {
  const date = typeof body?.date === 'string' ? body.date.trim() : ''
  if (!isValidDate(date)) {
    return { ok: false, message: 'วันที่จ่ายเงินไม่ถูกต้อง' }
  }
  const closedPeriod = closedPeriodLabel(tenantId, date)
  if (closedPeriod) {
    return { ok: false, message: `งวดบัญชี ${closedPeriod} ปิดแล้ว` }
  }
  const payAccountId = typeof body?.pay_account_id === 'string' ? body.pay_account_id.trim() : ''
  if (!payAccountId) {
    return { ok: false, message: 'กรุณาเลือกบัญชีจ่ายเงิน' }
  }
  const payAcc = db.prepare(
    'SELECT id, type FROM accounts WHERE id = ? AND tenant_id = ?'
  ).get(payAccountId, tenantId) as { id: string; type: string } | undefined
  if (!payAcc || payAcc.type !== 'ASSET') {
    return { ok: false, message: 'บัญชีจ่ายเงินต้องเป็นหมวดสินทรัพย์ (ASSET) ของกิจการ' }
  }
  return { ok: true, date, payAccountId }
}

function postAdvanceJournal(
  tenantId: string,
  actor: string,
  now: string,
  date: string,
  advanceId: string,
  desc: string,
  amt: number,
  lines: JournalLineInput[]
) {
  const je = insertJournalEntry(tenantId, actor, {
    date,
    description: desc,
    referenceType: 'EMPLOYEE_ADVANCE',
    referenceId: advanceId,
    notes: desc,
    totalDebit: amt,
    totalCredit: amt,
    lines,
  })
  db.prepare(
    'UPDATE journal_entries SET is_posted = 1, posted_at = ?, posted_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
  ).run(now, actor, now, je.id, tenantId)
  return je
}

function handleCreateAdvance(req: Request, res: Response, employeeId: string, allowCustomRate = false) {
  const tenantId = req.user!.tenantId
  const emp = db.prepare(
    'SELECT id, code, first_name, last_name, employment_type, base_wage, status FROM employees WHERE id = ? AND tenant_id = ?'
  ).get(employeeId, tenantId) as any

  if (!emp) {
    return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลพนักงาน' })
  }
  if (emp.status !== 'ACTIVE') {
    return res.status(400).json({ success: false, message: 'พนักงานไม่อยู่ในสถานะปฏิบัติงาน' })
  }

  const kind = req.body?.kind
  if (kind !== 'ADVANCE' && kind !== 'LOAN') {
    return res.status(400).json({ success: false, message: 'ประเภทต้องเป็น ADVANCE หรือ LOAN' })
  }

  const rawAmount = Number(req.body?.amount)
  if (!Number.isFinite(rawAmount) || rawAmount <= 0 || rawAmount > 1_000_000) {
    return res.status(400).json({ success: false, message: 'จำนวนเงินต้องมากกว่า 0 และไม่เกิน 1,000,000 บาท' })
  }
  const amount = round2(rawAmount)
  if (amount <= 0 || amount > 1_000_000) {
    return res.status(400).json({ success: false, message: 'จำนวนเงินต้องมากกว่า 0 และไม่เกิน 1,000,000 บาท' })
  }

  const installments = kind === 'ADVANCE' ? 1 : Number(req.body?.installments ?? 1)
  if (!Number.isInteger(installments) || installments < 1 || installments > 24) {
    return res.status(400).json({ success: false, message: 'จำนวนงวดต้องเป็นจำนวนเต็ม 1–24 งวด' })
  }

  let interestRate = 0
  if (kind === 'LOAN') {
    if (allowCustomRate && req.body?.interest_rate !== undefined && req.body?.interest_rate !== null && req.body?.interest_rate !== '') {
      const rawRate = Number(req.body.interest_rate)
      if (!Number.isFinite(rawRate) || rawRate < 0 || rawRate > 15) {
        return res.status(400).json({ success: false, message: 'ดอกเบี้ยต้องอยู่ระหว่าง 0–15% ต่อปี' })
      }
      interestRate = round2(rawRate)
    } else {
      interestRate = round2(Number(getTenantHrSettings(tenantId).loanInterestRatePct ?? 0))
    }
  }
  const interestAmount = kind === 'LOAN' ? round2(amount * interestRate / 100 * installments / 12) : 0
  const installmentAmount = Math.ceil(Math.round((amount + interestAmount) * 100) / installments) / 100

  const startPeriod = typeof req.body?.start_period === 'string' ? req.body.start_period.trim() : ''
  if (!PERIOD_RE.test(startPeriod) || startPeriod < thaiDateStr().slice(0, 7)) {
    return res.status(400).json({ success: false, message: 'งวดเริ่มต้นต้องเป็นรูปแบบ YYYY-MM และไม่ก่อนงวดปัจจุบัน' })
  }

  const baseWage = Number(emp.base_wage) || 0
  const monthlyWage = round2(
    emp.employment_type === 'DAILY'
      ? baseWage * 26
      : emp.employment_type === 'HOURLY'
        ? baseWage * 8 * 26
        : baseWage
  )

  if (kind === 'ADVANCE' && amount > monthlyWage) {
    return res.status(400).json({ success: false, message: 'ยอดเบิกเกินค่าจ้างประมาณ 1 เดือน' })
  }
  if (kind === 'LOAN' && installmentAmount > round2(monthlyWage * 0.1)) {
    return res.status(400).json({
      success: false,
      message: 'ยอดผ่อนต่องวดเกิน 10% ของค่าจ้าง (ม.76) — เพิ่มจำนวนงวด',
    })
  }

  const id = generateId()
  const now = new Date().toISOString()
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : null
  const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim()
  const amtText = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const description =
    kind === 'ADVANCE'
      ? `ขอเบิกล่วงหน้า ${amtText} บาท · ${emp.code} ${empName}`
      : `ขอยืมเงิน ${amtText} บาท ผ่อน ${installments} งวด · ${emp.code} ${empName}`

  db.transaction(() => {
    db.prepare(`
      INSERT INTO employee_advances (
        id, tenant_id, employee_id, kind, amount, installments, installment_amount,
        interest_rate, interest_amount,
        start_period, reason, status, approval_request_id, requested_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, ?)
    `).run(
      id, tenantId, emp.id, kind, amount, installments, installmentAmount,
      interestRate, interestAmount,
      startPeriod, reason, req.user!.userId, now, now
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
      category: 'advance',
      refType: 'employee_advances',
      refId: id,
      description,
      amount,
    })

    db.prepare('UPDATE employee_advances SET approval_request_id = ? WHERE id = ? AND tenant_id = ?')
      .run(apr.id, id, tenantId)
  })()

  return res.status(201).json({ success: true, data: getAdvanceById(tenantId, id) })
}

// A4: GET /me/advances (self) — วางก่อน /advances/:id
router.get('/me/advances', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)
    if (!selfEmp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }

    const rows = db.prepare(`
      ${ADVANCE_SELECT}
      WHERE a.tenant_id = ? AND a.employee_id = ?
      ORDER BY a.created_at DESC
    `).all(tenantId, selfEmp.id) as any[]

    res.json({ success: true, data: rows.map((r) => formatAdvance(tenantId, r)) })
  } catch (err: any) {
    console.error('Get my advances error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// A5: POST /me/advances (self)
router.post('/me/advances', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)
    if (!selfEmp) {
      return res.status(404).json({ success: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงาน' })
    }
    return handleCreateAdvance(req, res, selfEmp.id, false)
  } catch (err: any) {
    console.error('Create my advance error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// A1: GET /advances (hr:read)
router.get('/advances', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const conditions: string[] = ['a.tenant_id = ?']
    const params: any[] = [tenantId]

    if (typeof req.query.employee_id === 'string' && req.query.employee_id.trim()) {
      conditions.push('a.employee_id = ?')
      params.push(req.query.employee_id.trim())
    }
    if (typeof req.query.status === 'string' && req.query.status.trim()) {
      conditions.push('a.status = ?')
      params.push(req.query.status.trim())
    }

    const rows = db.prepare(`
      ${ADVANCE_SELECT}
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.created_at DESC
    `).all(...params) as any[]

    res.json({ success: true, data: rows.map((r) => formatAdvance(tenantId, r)) })
  } catch (err: any) {
    console.error('Get advances error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// A2: GET /advances/:id (hr:read)
router.get('/advances/:id', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'read')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const detail = getAdvanceDetail(tenantId, req.params.id)
    if (!detail) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการเบิก/เงินยืม' })
    }

    res.json({ success: true, data: detail })
  } catch (err: any) {
    console.error('Get advance detail error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// A3: POST /advances (hr:write)
router.post('/advances', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const employeeId = typeof req.body?.employee_id === 'string' ? req.body.employee_id.trim() : ''
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสพนักงาน' })
    }

    return handleCreateAdvance(req, res, employeeId, true)
  } catch (err: any) {
    console.error('Create advance error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// A6: POST /advances/:id/cancel (hr:write หรือ self ที่เป็นเจ้าของ)
router.post('/advances/:id/cancel', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const row = db.prepare(
      'SELECT * FROM employee_advances WHERE id = ? AND tenant_id = ?'
    ).get(req.params.id, tenantId) as any

    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการเบิก/เงินยืม' })
    }

    const hasHrWrite = userHasHr(req, 'write')
    const selfEmp = getSelfEmployee(tenantId, req.user!.userId)
    const isOwner = Boolean(selfEmp && row.employee_id === selfEmp.id)
    if (!hasHrWrite && !isOwner) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ยกเลิกรายการนี้' })
    }

    // ponytail: ยังไม่มียกเลิกหลังจ่ายเงินแล้ว (ต้องทำ JV กลับเอง) และไม่คิดดอกเบี้ย
    if (row.status !== 'PENDING' && row.status !== 'APPROVED') {
      return res.status(409).json({ success: false, message: 'ไม่สามารถยกเลิกรายการนี้ได้' })
    }

    const now = new Date().toISOString()
    db.transaction(() => {
      db.prepare(`
        UPDATE employee_advances
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
    })()

    res.json({ success: true, data: getAdvanceById(tenantId, row.id) })
  } catch (err: any) {
    console.error('Cancel advance error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// A7: POST /advances/:id/disburse (hr:write)
router.post('/advances/:id/disburse', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const row = db.prepare(`
      SELECT a.*, e.code AS employee_code
      FROM employee_advances a
      JOIN employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการเบิก/เงินยืม' })
    }
    if (row.status !== 'APPROVED') {
      return res.status(409).json({ success: false, message: 'จ่ายเงินได้เฉพาะรายการที่อนุมัติแล้ว (APPROVED) เท่านั้น' })
    }

    const check = validateDateAndAssetAccount(tenantId, req.body)
    if (!check.ok) {
      return res.status(400).json({ success: false, message: check.message })
    }
    const { date, payAccountId } = check

    const actor = req.user!.email || req.user!.userId
    const amt = round2(Number(row.amount))
    const desc =
      row.kind === 'ADVANCE'
        ? `จ่ายเงินเบิกล่วงหน้า · ${row.employee_code}`
        : `จ่ายเงินยืมพนักงาน · ${row.employee_code}`
    const now = new Date().toISOString()

    db.transaction(() => {
      // จองสถานะก่อนลงบัญชี — กดจ่ายซ้ำพร้อมกันต้องได้ JE ใบเดียว
      const claimed = db.prepare("UPDATE employee_advances SET status = 'ACTIVE', updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'APPROVED'")
        .run(now, row.id, tenantId)
      if (claimed.changes === 0) throw new Error('ALREADY_DISBURSED')
      const receivableAccountId = getOrCreateAccount(tenantId, ACC.EMPLOYEE_RECEIVABLE)
      const je = postAdvanceJournal(tenantId, actor, now, date, row.id, desc, amt, [
        { accountId: receivableAccountId, debit: amt, credit: 0, description: desc },
        { accountId: payAccountId, debit: 0, credit: amt, description: desc },
      ])

      db.prepare(`
        UPDATE employee_advances
        SET status = 'ACTIVE', disbursed_on = ?, pay_account_id = ?, disburse_je_id = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(date, payAccountId, je.id, now, row.id, tenantId)
    })()

    res.json({ success: true, data: getAdvanceById(tenantId, row.id) })
  } catch (err: any) {
    if (err?.message === 'ALREADY_DISBURSED') {
      return res.status(409).json({ success: false, message: 'รายการนี้จ่ายเงินไปแล้ว' })
    }
    if (isHeaderAccountError(err)) {
      return res.status(400).json({ success: false, message: err.message })
    }
    console.error('Disburse advance error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// A8: POST /advances/:id/repay-cash (hr:write)
router.post('/advances/:id/repay-cash', (req: Request, res: Response) => {
  try {
    if (!userHasHr(req, 'write')) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึง' })
    }

    const tenantId = req.user!.tenantId
    const row = db.prepare(`
      SELECT a.*, e.code AS employee_code
      FROM employee_advances a
      JOIN employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!row) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการเบิก/เงินยืม' })
    }
    if (row.status !== 'ACTIVE') {
      return res.status(409).json({ success: false, message: 'รับคืนเงินสดได้เฉพาะรายการที่กำลังหักชำระ (ACTIVE) เท่านั้น' })
    }

    const rawAmount = Number(req.body?.amount)
    const amount = Number.isFinite(rawAmount) ? round2(rawAmount) : NaN
    const currentOutstanding = advanceOutstanding(tenantId, row.id)
    if (!Number.isFinite(amount) || amount <= 0 || amount > currentOutstanding) {
      return res.status(400).json({ success: false, message: 'จำนวนเงินรับคืนต้องมากกว่า 0 และไม่เกินยอดคงค้าง' })
    }

    const check = validateDateAndAssetAccount(tenantId, req.body)
    if (!check.ok) {
      return res.status(400).json({ success: false, message: check.message })
    }
    const { date, payAccountId } = check

    const actor = req.user!.email || req.user!.userId
    const desc =
      row.kind === 'ADVANCE'
        ? `รับคืนเงินเบิกล่วงหน้า · ${row.employee_code}`
        : `รับคืนเงินยืมพนักงาน · ${row.employee_code}`
    const now = new Date().toISOString()

    db.transaction(() => {
      const cur = db.prepare('SELECT status FROM employee_advances WHERE id = ? AND tenant_id = ?')
        .get(row.id, tenantId) as { status: string } | undefined
      if (!cur || cur.status !== 'ACTIVE') throw new Error('NOT_ACTIVE')
      if (amount > advanceOutstanding(tenantId, row.id)) throw new Error('OVER_OUTSTANDING')

      // ponytail: ปิดก่อนกำหนดยังเก็บดอกเบี้ยคงที่เต็มจำนวน (ไม่มีส่วนลดดอกเบี้ย)
      const interest = interestPortion(tenantId, row.id, amount)
      const principal = round2(amount - interest)
      const receivableAccountId = getOrCreateAccount(tenantId, ACC.EMPLOYEE_RECEIVABLE)
      const lines: JournalLineInput[] = [
        { accountId: payAccountId, debit: amount, credit: 0, description: desc },
      ]
      if (principal > 0) {
        lines.push({ accountId: receivableAccountId, debit: 0, credit: principal, description: desc })
      }
      if (interest > 0) {
        const interestAccountId = getOrCreateAccount(tenantId, ACC.INTEREST_INCOME)
        lines.push({ accountId: interestAccountId, debit: 0, credit: interest, description: desc })
      }

      const je = postAdvanceJournal(tenantId, actor, now, date, row.id, desc, amount, lines)

      db.prepare(`
        INSERT INTO advance_repayments (
          id, tenant_id, advance_id, run_id, period, amount, interest, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CASH', ?)
      `).run(generateId(), tenantId, row.id, je.id, date.slice(0, 7), amount, interest, now)

      if (advanceOutstanding(tenantId, row.id) <= 0) {
        db.prepare(
          "UPDATE employee_advances SET status = 'CLOSED', updated_at = ? WHERE id = ? AND tenant_id = ?"
        ).run(now, row.id, tenantId)
      }
    })()

    res.json({ success: true, data: getAdvanceDetail(tenantId, row.id) })
  } catch (err: any) {
    if (err?.message === 'NOT_ACTIVE') {
      return res.status(409).json({ success: false, message: 'รับคืนเงินสดได้เฉพาะรายการที่กำลังหักชำระ (ACTIVE) เท่านั้น' })
    }
    if (err?.message === 'OVER_OUTSTANDING') {
      return res.status(400).json({ success: false, message: 'จำนวนเงินรับคืนต้องมากกว่า 0 และไม่เกินยอดคงค้าง' })
    }
    if (isHeaderAccountError(err)) {
      return res.status(400).json({ success: false, message: err.message })
    }
    console.error('Repay cash advance error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

export default router
