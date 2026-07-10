import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import db from '../db/sqlite'
import { generateId, formatDocumentNumber } from '../utils/id'
import { ACC, ACC_META } from '../config/accountCodes'
import { getOrCreateAccount } from '../services/accounting.service'

const router = Router()
router.use(authenticate)

// GET /api/subcontracts/stats
router.get('/stats', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const openContracts = (db.prepare(
      `SELECT COUNT(*) as c FROM wo_subcontracts WHERE tenant_id = ? AND status = 'OPEN'`
    ).get(tenantId) as any).c

    const outstandingAmount = (db.prepare(
      `SELECT COALESCE(SUM(MAX(labor_amount - paid_amount, 0)), 0) as total
       FROM wo_subcontracts WHERE tenant_id = ? AND status != 'CANCELLED'`
    ).get(tenantId) as any).total

    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const paidThisMonth = (db.prepare(
      `SELECT COALESCE(SUM(total_debit), 0) as total FROM journal_entries
       WHERE tenant_id = ? AND reference_type = 'SUBCONTRACT_PAYMENT' AND date >= ?`
    ).get(tenantId, monthStart) as any).total

    res.json({ success: true, data: { openContracts, outstandingAmount, paidThisMonth } })
  } catch (error) {
    console.error('Get subcontract stats error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch subcontract stats' })
  }
})

// GET /api/subcontracts?work_order_id=&status=
router.get('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { work_order_id, status } = req.query

    let query = `
      SELECT sc.*, s.name as supplier_name, s.code as supplier_code,
        wo.wo_number, wo.product_name as wo_product_name
      FROM wo_subcontracts sc
      LEFT JOIN suppliers s ON sc.supplier_id = s.id
      LEFT JOIN work_orders wo ON sc.work_order_id = wo.id
      WHERE sc.tenant_id = ?
    `
    const params: Array<string> = [tenantId]

    if (work_order_id) {
      query += ' AND sc.work_order_id = ?'
      params.push(work_order_id as string)
    }
    if (status) {
      query += ' AND sc.status = ?'
      params.push(status as string)
    }
    query += ' ORDER BY sc.created_at DESC'

    const rows = db.prepare(query).all(...params)
    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('Get subcontracts error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch subcontracts' })
  }
})

// GET /api/subcontracts/:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const contract = db.prepare(`
      SELECT sc.*, s.name as supplier_name, s.code as supplier_code,
        wo.wo_number, wo.product_name as wo_product_name
      FROM wo_subcontracts sc
      LEFT JOIN suppliers s ON sc.supplier_id = s.id
      LEFT JOIN work_orders wo ON sc.work_order_id = wo.id
      WHERE sc.id = ? AND sc.tenant_id = ?
    `).get(req.params.id, tenantId) as any

    if (!contract) return void res.status(404).json({ success: false, message: 'ไม่พบสัญญาจ้างเหมา' })

    const journalEntries = db.prepare(`
      SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_id = ?
      ORDER BY date ASC, created_at ASC
    `).all(tenantId, contract.contract_number) as any[]

    const entriesWithLines = journalEntries.map(entry => ({
      ...entry,
      lines: db.prepare(`
        SELECT jl.*, a.code as account_code, a.name as account_name
        FROM journal_lines jl
        JOIN accounts a ON jl.account_id = a.id
        WHERE jl.journal_entry_id = ?
        ORDER BY jl.line_number
      `).all(entry.id),
    }))

    res.json({ success: true, data: { ...contract, journal_entries: entriesWithLines } })
  } catch (error) {
    console.error('Get subcontract detail error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch subcontract' })
  }
})

// POST /api/subcontracts
router.post('/', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { work_order_id, supplier_id, rate_per_unit, agreed_qty, wht_rate, due_date, notes, contract_type } = req.body

    if (!work_order_id || !supplier_id) {
      return void res.status(400).json({ success: false, message: 'ต้องระบุใบสั่งงานและผู้รับเหมา' })
    }
    if (!rate_per_unit || Number(rate_per_unit) <= 0) {
      return void res.status(400).json({ success: false, message: 'ต้องระบุเรทต่อหน่วยมากกว่า 0' })
    }
    if (!agreed_qty || Number(agreed_qty) <= 0) {
      return void res.status(400).json({ success: false, message: 'ต้องระบุจำนวนที่ตกลงมากกว่า 0' })
    }

    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(work_order_id, tenantId)
    if (!wo) return void res.status(404).json({ success: false, message: 'ไม่พบใบสั่งงาน' })

    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?').get(supplier_id, tenantId) as any
    if (!supplier) return void res.status(404).json({ success: false, message: 'ไม่พบผู้รับเหมา/ผู้จำหน่าย' })

    const id = generateId()
    const contractNumber = formatDocumentNumber('SC', tenantId, 'SUBCONTRACT', undefined, 5)
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO wo_subcontracts
        (id, tenant_id, contract_number, work_order_id, supplier_id, supplier_name, contract_type,
         rate_per_unit, agreed_qty, wht_rate, due_date, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, tenantId, contractNumber, work_order_id, supplier_id, supplier.name,
      contract_type || 'PIECE_RATE', Number(rate_per_unit), Number(agreed_qty),
      wht_rate !== undefined && wht_rate !== null && wht_rate !== '' ? Number(wht_rate) : 3,
      due_date || null, notes || '', now, now
    )

    const row = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(id, tenantId)
    res.status(201).json({ success: true, data: row, message: 'สร้างสัญญาจ้างเหมาสำเร็จ' })
  } catch (error) {
    console.error('Create subcontract error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to create subcontract' })
  }
})

// PUT /api/subcontracts/:id — แก้ได้เฉพาะตอนยังไม่มี billed_qty
router.put('/:id', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const contract = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!contract) return void res.status(404).json({ success: false, message: 'ไม่พบสัญญาจ้างเหมา' })
    if (contract.billed_qty > 0) {
      return void res.status(400).json({ success: false, message: 'ไม่สามารถแก้ไขสัญญาที่มีการคิดค่าแรงไปแล้ว' })
    }

    const { rate_per_unit, agreed_qty, due_date, notes } = req.body
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE wo_subcontracts
      SET rate_per_unit = COALESCE(?, rate_per_unit),
          agreed_qty = COALESCE(?, agreed_qty),
          due_date = COALESCE(?, due_date),
          notes = COALESCE(?, notes),
          updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(
      rate_per_unit !== undefined ? Number(rate_per_unit) : null,
      agreed_qty !== undefined ? Number(agreed_qty) : null,
      due_date !== undefined ? due_date : null,
      notes !== undefined ? notes : null,
      now, req.params.id, tenantId
    )

    const row = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId)
    res.json({ success: true, data: row, message: 'บันทึกการแก้ไขสำเร็จ' })
  } catch (error) {
    console.error('Update subcontract error:', error)
    res.status(500).json({ success: false, message: 'Failed to update subcontract' })
  }
})

// POST /api/subcontracts/:id/pay
router.post('/:id/pay', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const contract = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!contract) return void res.status(404).json({ success: false, message: 'ไม่พบสัญญาจ้างเหมา' })
    if (contract.status === 'CANCELLED') {
      return void res.status(400).json({ success: false, message: 'สัญญานี้ถูกยกเลิกแล้ว' })
    }

    const outstanding = Math.round((contract.labor_amount - contract.paid_amount) * 100) / 100
    if (outstanding <= 0) {
      return void res.status(400).json({ success: false, message: 'ไม่มียอดค้างจ่ายสำหรับสัญญานี้' })
    }

    const { payment_method, amount } = req.body
    if (!['CASH', 'BANK'].includes(payment_method)) {
      return void res.status(400).json({ success: false, message: 'ช่องทางชำระต้องเป็น CASH หรือ BANK' })
    }

    const payAmount = amount !== undefined && amount !== null && amount !== ''
      ? Math.round(Number(amount) * 100) / 100
      : outstanding

    if (!(payAmount > 0) || payAmount > outstanding + 0.01) {
      return void res.status(400).json({ success: false, message: 'จำนวนเงินที่จ่ายไม่ถูกต้อง' })
    }

    const whtAmount = Math.round(payAmount * (Number(contract.wht_rate) || 0) / 100 * 100) / 100
    const netAmount = Math.round((payAmount - whtAmount) * 100) / 100

    const accruedAccId = getOrCreateAccount(
      tenantId, ACC.ACCRUED,
      ACC_META[ACC.ACCRUED]!.name, ACC_META[ACC.ACCRUED]!.type,
      ACC_META[ACC.ACCRUED]!.category, ACC_META[ACC.ACCRUED]!.normalBalance
    )
    const cashBankCode = payment_method === 'CASH' ? ACC.CASH : ACC.BANK
    const cashBankAccId = getOrCreateAccount(
      tenantId, cashBankCode,
      ACC_META[cashBankCode]!.name, ACC_META[cashBankCode]!.type,
      ACC_META[cashBankCode]!.category, ACC_META[cashBankCode]!.normalBalance
    )
    const whtAccId = whtAmount > 0
      ? getOrCreateAccount(
          tenantId, ACC.WHT_PAYABLE,
          ACC_META[ACC.WHT_PAYABLE]!.name, ACC_META[ACC.WHT_PAYABLE]!.type,
          ACC_META[ACC.WHT_PAYABLE]!.category, ACC_META[ACC.WHT_PAYABLE]!.normalBalance
        )
      : null

    const now = new Date().toISOString()
    const journalId = generateId()
    const journalNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(now).getFullYear(), 5)
    const desc = `จ่ายค่าจ้างเหมา ${contract.contract_number} - ${contract.supplier_name}`

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO journal_entries
          (id, tenant_id, entry_number, date, reference_type, reference_id, description,
           total_debit, total_credit, is_auto_generated, is_posted, posted_at, posted_by,
           notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'SUBCONTRACT_PAYMENT', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
      `).run(
        journalId, tenantId, journalNumber, now.substring(0, 10), contract.contract_number, desc,
        payAmount, payAmount, now, req.user!.email,
        `จ่ายเงินสัญญา ${contract.contract_number} (${payment_method})`,
        req.user!.email, now, now
      )

      const insertLine = db.prepare(`
        INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      let lineNo = 1
      insertLine.run(generateId(), tenantId, journalId, accruedAccId, lineNo++, desc, payAmount, 0)
      insertLine.run(generateId(), tenantId, journalId, cashBankAccId, lineNo++, desc, 0, netAmount)
      if (whtAccId && whtAmount > 0) {
        insertLine.run(generateId(), tenantId, journalId, whtAccId, lineNo++, `ภาษีหัก ณ ที่จ่าย - ${contract.contract_number}`, 0, whtAmount)
      }

      const newPaid = Math.round((contract.paid_amount + payAmount) * 100) / 100
      const fullyPaid = newPaid >= contract.labor_amount - 0.01
      const fullyBilled = contract.billed_qty >= contract.agreed_qty
      const newStatus = fullyPaid && fullyBilled ? 'SETTLED' : contract.status

      db.prepare(`
        UPDATE wo_subcontracts SET paid_amount = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?
      `).run(newPaid, newStatus, now, contract.id, tenantId)
    })
    tx()

    const row = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(contract.id, tenantId)
    res.json({ success: true, data: row, message: 'บันทึกการจ่ายเงินสำเร็จ' })
  } catch (error) {
    console.error('Pay subcontract error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to pay subcontract' })
  }
})

// POST /api/subcontracts/:id/cancel — ยกเลิกได้เฉพาะ billed_qty = 0
router.post('/:id/cancel', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const contract = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!contract) return void res.status(404).json({ success: false, message: 'ไม่พบสัญญาจ้างเหมา' })
    if (contract.billed_qty > 0) {
      return void res.status(400).json({ success: false, message: 'ไม่สามารถยกเลิกสัญญาที่มีการคิดค่าแรงไปแล้ว' })
    }

    const now = new Date().toISOString()
    db.prepare(`UPDATE wo_subcontracts SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(now, req.params.id, tenantId)

    res.json({ success: true, message: 'ยกเลิกสัญญาแล้ว' })
  } catch (error) {
    console.error('Cancel subcontract error:', error)
    res.status(500).json({ success: false, message: 'Failed to cancel subcontract' })
  }
})

export default router
