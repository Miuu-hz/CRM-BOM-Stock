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

    // Phase 3: outsource (ส่งผลิตข้างนอก) metrics
    const subconStockValue = (db.prepare(
      `SELECT COALESCE(SUM(total_value), 0) as total FROM subcon_stock WHERE tenant_id = ?`
    ).get(tenantId) as any).total

    const outsourceMaterialOutstandingCount = (db.prepare(
      `SELECT COUNT(*) as c FROM wo_subcontracts
       WHERE tenant_id = ? AND contract_type = 'OUTSOURCE' AND status IN ('MATERIAL_SENT', 'PARTIAL_RECEIVED')`
    ).get(tenantId) as any).c

    const today = now.toISOString().substring(0, 10)
    const overdueAmount = (db.prepare(
      `SELECT COALESCE(SUM(MAX(labor_amount - paid_amount, 0)), 0) as total
       FROM wo_subcontracts
       WHERE tenant_id = ? AND status NOT IN ('SETTLED', 'CANCELLED', 'CLOSED')
         AND due_date IS NOT NULL AND due_date != '' AND due_date < ?`
    ).get(tenantId, today) as any).total

    res.json({
      success: true,
      data: {
        openContracts, outstandingAmount, paidThisMonth,
        subconStockValue, outsourceMaterialOutstandingCount, overdueAmount
      }
    })
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

// GET /api/subcontracts/subcon-stock — สมุด stock วัตถุดิบนอกบริษัท (อยู่ที่ผู้รับเหมา)
// NOTE: must be registered before GET /:id so "subcon-stock" is not captured as an :id param.
router.get('/subcon-stock', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const rows = db.prepare(
      `SELECT * FROM subcon_stock WHERE tenant_id = ? AND quantity > 0 ORDER BY supplier_name, item_name`
    ).all(tenantId) as any[]

    const bySupplier = new Map<string, { supplier_id: string; supplier_name: string; value: number; items: number }>()
    let totalValue = 0
    for (const r of rows) {
      const value = Number(r.total_value) || 0
      totalValue += value
      const cur = bySupplier.get(r.supplier_id) || { supplier_id: r.supplier_id, supplier_name: r.supplier_name, value: 0, items: 0 }
      cur.value += value
      cur.items += 1
      bySupplier.set(r.supplier_id, cur)
    }

    res.json({
      success: true,
      data: rows,
      summary: {
        total_value: Math.round(totalValue * 100) / 100,
        by_supplier: Array.from(bySupplier.values())
          .map(s => ({ ...s, value: Math.round(s.value * 100) / 100 }))
          .sort((a, b) => b.value - a.value)
      }
    })
  } catch (error) {
    console.error('Get subcon-stock error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch subcon stock' })
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

    // Phase 3: material issue/receipt journal entries are posted with reference_id = issue_number /
    // receipt_number (not contract_number) so gather those refs too, so the contract detail view shows
    // the full document trail (pay/accrual entries still key off contract_number as before).
    const issueNumbers = (db.prepare(
      'SELECT DISTINCT issue_number FROM subcon_material_issues WHERE tenant_id = ? AND subcontract_id = ?'
    ).all(tenantId, contract.id) as any[]).map(r => r.issue_number)
    const receiptNumbers = (db.prepare(
      'SELECT DISTINCT receipt_number FROM subcon_receipts WHERE tenant_id = ? AND subcontract_id = ?'
    ).all(tenantId, contract.id) as any[]).map(r => r.receipt_number)
    const refs = [contract.contract_number, ...issueNumbers, ...receiptNumbers]

    const journalEntries = db.prepare(`
      SELECT * FROM journal_entries WHERE tenant_id = ? AND reference_id IN (${refs.map(() => '?').join(',')})
      ORDER BY date ASC, created_at ASC
    `).all(tenantId, ...refs) as any[]

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

// POST /api/subcontracts/:id/issue-materials — ส่งวัตถุดิบให้ผู้รับเหมา (OUTSOURCE)
router.post('/:id/issue-materials', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const contract = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!contract) return void res.status(404).json({ success: false, message: 'ไม่พบสัญญาจ้างเหมา' })
    if (contract.contract_type !== 'OUTSOURCE') {
      return void res.status(400).json({ success: false, message: 'ใช้ได้เฉพาะสัญญาประเภทส่งผลิตข้างนอก (OUTSOURCE)' })
    }
    if (!['OPEN', 'MATERIAL_SENT', 'PARTIAL_RECEIVED'].includes(contract.status)) {
      return void res.status(400).json({ success: false, message: 'สถานะสัญญาไม่สามารถส่งวัตถุดิบเพิ่มได้' })
    }

    const { items } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return void res.status(400).json({ success: false, message: 'ต้องระบุรายการวัตถุดิบอย่างน้อย 1 รายการ' })
    }

    // Validate & preload stock items first (fail fast before mutating anything)
    const plan: Array<{ stockItem: any; qty: number }> = []
    for (const it of items) {
      const qty = Number(it?.quantity)
      if (!it?.stock_item_id || !(qty > 0)) {
        return void res.status(400).json({ success: false, message: 'ข้อมูลรายการวัตถุดิบไม่ถูกต้อง' })
      }
      const stockItem = db.prepare('SELECT * FROM stock_items WHERE id = ? AND tenant_id = ?').get(it.stock_item_id, tenantId) as any
      if (!stockItem) {
        return void res.status(404).json({ success: false, message: `ไม่พบสินค้าคงคลัง (${it.stock_item_id})` })
      }
      if (Number(stockItem.quantity) < qty) {
        return void res.status(400).json({ success: false, message: `สต็อกไม่พอสำหรับ ${stockItem.name} (คงเหลือ ${stockItem.quantity} ${stockItem.unit})` })
      }
      plan.push({ stockItem, qty })
    }

    const now = new Date().toISOString()
    const issueNumber = formatDocumentNumber('SMI', tenantId, 'SUBCON_ISSUE', undefined, 5)
    let totalValue = 0
    const issuedItems: any[] = []

    const tx = db.transaction(() => {
      for (const { stockItem, qty } of plan) {
        const unitCost = Number(stockItem.unit_cost) || 0
        const value = Math.round(qty * unitCost * 100) / 100
        totalValue = Math.round((totalValue + value) * 100) / 100

        db.prepare('UPDATE stock_items SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
          .run(qty, now, stockItem.id, tenantId)

        db.prepare(`
          INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
          VALUES (?, ?, ?, 'SUBCON_OUT', ?, ?, ?, ?, ?)
        `).run(generateId(), tenantId, stockItem.id, qty, contract.contract_number, `ส่งวัตถุดิบให้ผู้รับเหมา ${contract.supplier_name}`, now, req.user!.email)

        db.prepare(`
          INSERT INTO subcon_material_issues
            (id, tenant_id, issue_number, subcontract_id, stock_item_id, item_name, quantity, unit, unit_cost, total_value, issued_at, issued_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(generateId(), tenantId, issueNumber, contract.id, stockItem.id, stockItem.name, qty, stockItem.unit, unitCost, value, now, req.user!.email)

        const existing = db.prepare(
          'SELECT * FROM subcon_stock WHERE tenant_id = ? AND supplier_id = ? AND stock_item_id = ?'
        ).get(tenantId, contract.supplier_id, stockItem.id) as any
        if (existing) {
          db.prepare('UPDATE subcon_stock SET quantity = quantity + ?, total_value = total_value + ?, updated_at = ? WHERE id = ?')
            .run(qty, value, now, existing.id)
        } else {
          db.prepare(`
            INSERT INTO subcon_stock (id, tenant_id, supplier_id, supplier_name, stock_item_id, item_name, unit, quantity, total_value, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(generateId(), tenantId, contract.supplier_id, contract.supplier_name, stockItem.id, stockItem.name, stockItem.unit, qty, value, now)
        }

        issuedItems.push({ stock_item_id: stockItem.id, item_name: stockItem.name, quantity: qty, unit_cost: unitCost, total_value: value })
      }

      if (totalValue > 0) {
        const subconMaterialAccId = getOrCreateAccount(
          tenantId, ACC.SUBCON_MATERIAL,
          ACC_META[ACC.SUBCON_MATERIAL]!.name, ACC_META[ACC.SUBCON_MATERIAL]!.type,
          ACC_META[ACC.SUBCON_MATERIAL]!.category, ACC_META[ACC.SUBCON_MATERIAL]!.normalBalance
        )
        const rawMaterialAccId = getOrCreateAccount(
          tenantId, ACC.RAW_MATERIAL,
          ACC_META[ACC.RAW_MATERIAL]!.name, ACC_META[ACC.RAW_MATERIAL]!.type,
          ACC_META[ACC.RAW_MATERIAL]!.category, ACC_META[ACC.RAW_MATERIAL]!.normalBalance
        )

        const journalId = generateId()
        const journalNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(now).getFullYear(), 5)
        const desc = `ส่งวัตถุดิบให้ผู้รับเหมา ${issueNumber} - ${contract.supplier_name} (${contract.contract_number})`

        db.prepare(`
          INSERT INTO journal_entries
            (id, tenant_id, entry_number, date, reference_type, reference_id, description,
             total_debit, total_credit, is_auto_generated, is_posted, posted_at, posted_by,
             notes, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'SUBCON_MATERIAL_ISSUE', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
        `).run(
          journalId, tenantId, journalNumber, now.substring(0, 10), issueNumber, desc,
          totalValue, totalValue, now, req.user!.email,
          desc, req.user!.email, now, now
        )

        const insertLine = db.prepare(`
          INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        insertLine.run(generateId(), tenantId, journalId, subconMaterialAccId, 1, desc, totalValue, 0)
        insertLine.run(generateId(), tenantId, journalId, rawMaterialAccId, 2, desc, 0, totalValue)
      }

      if (contract.status === 'OPEN') {
        db.prepare(`UPDATE wo_subcontracts SET status = 'MATERIAL_SENT', updated_at = ? WHERE id = ? AND tenant_id = ?`)
          .run(now, contract.id, tenantId)
      } else {
        db.prepare(`UPDATE wo_subcontracts SET updated_at = ? WHERE id = ? AND tenant_id = ?`)
          .run(now, contract.id, tenantId)
      }
    })
    tx()

    const row = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(contract.id, tenantId)
    res.status(201).json({
      success: true,
      data: { contract: row, issue_number: issueNumber, total_value: totalValue, items: issuedItems },
      message: 'บันทึกการส่งวัตถุดิบสำเร็จ'
    })
  } catch (error) {
    console.error('Issue materials error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to issue materials' })
  }
})

// POST /api/subcontracts/:id/receipts — รับของกลับ + ตรวจนับ + เคลียร์วัตถุดิบนอกบริษัท (OUTSOURCE)
router.post('/:id/receipts', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const contract = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!contract) return void res.status(404).json({ success: false, message: 'ไม่พบสัญญาจ้างเหมา' })
    if (contract.contract_type !== 'OUTSOURCE') {
      return void res.status(400).json({ success: false, message: 'ใช้ได้เฉพาะสัญญาประเภทส่งผลิตข้างนอก (OUTSOURCE)' })
    }
    if (['CANCELLED', 'SETTLED', 'CLOSED'].includes(contract.status)) {
      return void res.status(400).json({ success: false, message: 'สัญญานี้ปิดแล้ว ไม่สามารถรับของเพิ่มได้' })
    }

    let { received_qty, scrap_qty, shortage_qty, materials, notes } = req.body
    received_qty = Number(received_qty) || 0
    scrap_qty = Number(scrap_qty) || 0
    shortage_qty = Number(shortage_qty) || 0
    materials = Array.isArray(materials) ? materials : []

    if (received_qty <= 0 && scrap_qty <= 0 && shortage_qty <= 0 && materials.length === 0) {
      return void res.status(400).json({ success: false, message: 'ต้องระบุจำนวนที่รับหรือรายการเคลียร์วัตถุดิบอย่างน้อยหนึ่งอย่าง' })
    }

    // Validate every material line against subcon_stock before mutating anything
    const matPlan: Array<{ stockRow: any; consumed: number; returned: number; shortage: number; total: number; avgCost: number; stockItemId: string }> = []
    for (const m of materials) {
      const consumed = Number(m?.consumed_qty) || 0
      const returned = Number(m?.returned_qty) || 0
      const shortage = Number(m?.shortage_qty) || 0
      const total = consumed + returned + shortage
      if (total <= 0) continue

      const stockRow = db.prepare(
        'SELECT * FROM subcon_stock WHERE tenant_id = ? AND supplier_id = ? AND stock_item_id = ?'
      ).get(tenantId, contract.supplier_id, m.stock_item_id) as any
      const available = stockRow ? Number(stockRow.quantity) : 0
      if (total > available + 0.0001) {
        const itemName = stockRow?.item_name || m.stock_item_id
        return void res.status(400).json({
          success: false,
          message: `จำนวนเคลียร์เกินยอดวัตถุดิบค้างที่ผู้รับเหมา (${itemName}: ค้าง ${available}, ขอเคลียร์ ${total})`
        })
      }
      const avgCost = available > 0 ? Number(stockRow.total_value) / available : 0
      matPlan.push({ stockRow, consumed, returned, shortage, total, avgCost, stockItemId: m.stock_item_id })
    }

    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND tenant_id = ?').get(contract.work_order_id, tenantId) as any

    const now = new Date().toISOString()
    const receiptNumber = formatDocumentNumber('SRC', tenantId, 'SUBCON_RECEIPT', undefined, 5)

    let totalConsumedValue = 0, totalReturnedValue = 0, totalShortageValue = 0
    const reconcileDetail: any[] = []
    let qcInspectionId: string | null = null

    const tx = db.transaction(() => {
      for (const p of matPlan) {
        const consumedValue = Math.round(p.consumed * p.avgCost * 100) / 100
        const returnedValue = Math.round(p.returned * p.avgCost * 100) / 100
        const shortageValue = Math.round(p.shortage * p.avgCost * 100) / 100
        totalConsumedValue = Math.round((totalConsumedValue + consumedValue) * 100) / 100
        totalReturnedValue = Math.round((totalReturnedValue + returnedValue) * 100) / 100
        totalShortageValue = Math.round((totalShortageValue + shortageValue) * 100) / 100

        db.prepare('UPDATE subcon_stock SET quantity = quantity - ?, total_value = total_value - ?, updated_at = ? WHERE id = ?')
          .run(p.total, consumedValue + returnedValue + shortageValue, now, p.stockRow.id)

        if (p.returned > 0) {
          db.prepare('UPDATE stock_items SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
            .run(p.returned, now, p.stockItemId, tenantId)
          db.prepare(`
            INSERT INTO stock_movements (id, tenant_id, stock_item_id, type, quantity, reference, notes, created_at, created_by)
            VALUES (?, ?, ?, 'SUBCON_RETURN', ?, ?, ?, ?, ?)
          `).run(generateId(), tenantId, p.stockItemId, p.returned, contract.contract_number, `รับวัตถุดิบคืนจาก ${contract.supplier_name}`, now, req.user!.email)
        }

        reconcileDetail.push({
          stock_item_id: p.stockItemId, item_name: p.stockRow.item_name,
          consumed_qty: p.consumed, returned_qty: p.returned, shortage_qty: p.shortage,
          avg_cost: Math.round(p.avgCost * 10000) / 10000,
          consumed_value: consumedValue, returned_value: returnedValue, shortage_value: shortageValue,
        })
      }

      const totalCleared = Math.round((totalConsumedValue + totalReturnedValue + totalShortageValue) * 100) / 100
      if (totalCleared > 0) {
        const subconMaterialAccId = getOrCreateAccount(
          tenantId, ACC.SUBCON_MATERIAL,
          ACC_META[ACC.SUBCON_MATERIAL]!.name, ACC_META[ACC.SUBCON_MATERIAL]!.type,
          ACC_META[ACC.SUBCON_MATERIAL]!.category, ACC_META[ACC.SUBCON_MATERIAL]!.normalBalance
        )
        const rawMaterialAccId = totalReturnedValue > 0 ? getOrCreateAccount(
          tenantId, ACC.RAW_MATERIAL,
          ACC_META[ACC.RAW_MATERIAL]!.name, ACC_META[ACC.RAW_MATERIAL]!.type,
          ACC_META[ACC.RAW_MATERIAL]!.category, ACC_META[ACC.RAW_MATERIAL]!.normalBalance
        ) : null
        const cogsRawAccId = totalConsumedValue > 0 ? getOrCreateAccount(
          tenantId, ACC.COGS_RAW_MATERIAL,
          ACC_META[ACC.COGS_RAW_MATERIAL]!.name, ACC_META[ACC.COGS_RAW_MATERIAL]!.type,
          ACC_META[ACC.COGS_RAW_MATERIAL]!.category, ACC_META[ACC.COGS_RAW_MATERIAL]!.normalBalance
        ) : null
        const otherReceivableAccId = totalShortageValue > 0 ? getOrCreateAccount(
          tenantId, ACC.OTHER_RECEIVABLE,
          ACC_META[ACC.OTHER_RECEIVABLE]!.name, ACC_META[ACC.OTHER_RECEIVABLE]!.type,
          ACC_META[ACC.OTHER_RECEIVABLE]!.category, ACC_META[ACC.OTHER_RECEIVABLE]!.normalBalance
        ) : null

        const journalId = generateId()
        const journalNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(now).getFullYear(), 5)
        const desc = `รับของ/เคลียร์วัตถุดิบผู้รับเหมา ${receiptNumber} - ${contract.supplier_name} (${contract.contract_number})`

        db.prepare(`
          INSERT INTO journal_entries
            (id, tenant_id, entry_number, date, reference_type, reference_id, description,
             total_debit, total_credit, is_auto_generated, is_posted, posted_at, posted_by,
             notes, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'SUBCON_RECEIPT', ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
        `).run(
          journalId, tenantId, journalNumber, now.substring(0, 10), receiptNumber, desc,
          totalCleared, totalCleared, now, req.user!.email,
          desc, req.user!.email, now, now
        )

        const insertLine = db.prepare(`
          INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        let lineNo = 1
        if (rawMaterialAccId && totalReturnedValue > 0) {
          insertLine.run(generateId(), tenantId, journalId, rawMaterialAccId, lineNo++, `${desc} (คืนวัตถุดิบ)`, totalReturnedValue, 0)
        }
        if (cogsRawAccId && totalConsumedValue > 0) {
          insertLine.run(generateId(), tenantId, journalId, cogsRawAccId, lineNo++, `${desc} (วัตถุดิบใช้ไป)`, totalConsumedValue, 0)
        }
        if (otherReceivableAccId && totalShortageValue > 0) {
          insertLine.run(generateId(), tenantId, journalId, otherReceivableAccId, lineNo++, `${desc} (วัตถุดิบขาดหาย)`, totalShortageValue, 0)
        }
        insertLine.run(generateId(), tenantId, journalId, subconMaterialAccId, lineNo++, desc, 0, totalCleared)
      }

      // สร้าง QC inspection อัตโนมัติ ถ้ามีของดีรับเข้ามา — FG เข้าสต็อกจริงเมื่อ QC complete แล้ว WO ปิด (Phase 1)
      if (received_qty > 0) {
        qcInspectionId = generateId()
        const checklist = db.prepare(
          `SELECT * FROM qc_checklists WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at ASC LIMIT 1`
        ).get(tenantId) as any

        if (checklist) {
          const results = (JSON.parse(checklist.check_items) as any[]).map(item => ({
            item_id: item.id, item_name: item.name, type: item.type || 'passfail',
            expected: item.expected || '', unit: item.unit || '',
            result: 'PENDING', actual_value: '', notes: '',
          }))
          db.prepare(`
            INSERT INTO qc_inspections
              (id, tenant_id, checklist_id, checklist_name, work_order_ref, work_order_id, product_name, inspector_name, status, results, inspected_qty)
            VALUES (?, ?, ?, ?, ?, ?, ?, '', 'PENDING', ?, ?)
          `).run(
            qcInspectionId, tenantId, checklist.id, checklist.name,
            wo?.wo_number || '', contract.work_order_id, wo?.product_name || '',
            JSON.stringify(results), received_qty
          )
        } else {
          db.prepare(`
            INSERT INTO qc_inspections
              (id, tenant_id, checklist_id, checklist_name, work_order_ref, work_order_id, product_name, inspector_name, status, results, inspected_qty)
            VALUES (?, ?, '', '', ?, ?, ?, '', 'PENDING', '[]', ?)
          `).run(qcInspectionId, tenantId, wo?.wo_number || '', contract.work_order_id, wo?.product_name || '', received_qty)
        }
      }

      db.prepare(`
        INSERT INTO subcon_receipts
          (id, tenant_id, receipt_number, subcontract_id, received_qty, scrap_qty, shortage_qty,
           qc_inspection_id, material_reconcile, notes, received_at, received_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        generateId(), tenantId, receiptNumber, contract.id, received_qty, scrap_qty, shortage_qty,
        qcInspectionId, JSON.stringify(reconcileDetail), notes || '', now, req.user!.email
      )

      const newReceived = (Number(contract.received_qty) || 0) + received_qty
      const newStatus = newReceived >= contract.agreed_qty ? 'RECEIVED' : 'PARTIAL_RECEIVED'
      db.prepare(`
        UPDATE wo_subcontracts SET received_qty = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?
      `).run(newReceived, newStatus, now, contract.id, tenantId)
    })
    tx()

    const row = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(contract.id, tenantId)
    res.status(201).json({
      success: true,
      data: { contract: row, receipt_number: receiptNumber, qc_inspection_id: qcInspectionId, material_reconcile: reconcileDetail },
      message: 'บันทึกการรับของสำเร็จ'
    })
  } catch (error) {
    console.error('Subcontract receipt error:', error)
    res.status(500).json({ success: false, message: (error as Error).message || 'Failed to record receipt' })
  }
})

// GET /api/subcontracts/:id/reconcile — สรุปวัตถุดิบ + ชิ้นงานต่อสัญญา
router.get('/:id/reconcile', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const contract = db.prepare('SELECT * FROM wo_subcontracts WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as any
    if (!contract) return void res.status(404).json({ success: false, message: 'ไม่พบสัญญาจ้างเหมา' })

    const issues = db.prepare(
      'SELECT * FROM subcon_material_issues WHERE tenant_id = ? AND subcontract_id = ? ORDER BY issued_at ASC'
    ).all(tenantId, contract.id) as any[]
    const receipts = db.prepare(
      'SELECT * FROM subcon_receipts WHERE tenant_id = ? AND subcontract_id = ? ORDER BY received_at ASC'
    ).all(tenantId, contract.id) as any[]

    const byItem = new Map<string, any>()
    for (const iss of issues) {
      const cur = byItem.get(iss.stock_item_id) || {
        stock_item_id: iss.stock_item_id, item_name: iss.item_name, unit: iss.unit,
        issued_qty: 0, issued_value: 0, consumed_qty: 0, returned_qty: 0, shortage_qty: 0
      }
      cur.issued_qty += Number(iss.quantity) || 0
      cur.issued_value += Number(iss.total_value) || 0
      byItem.set(iss.stock_item_id, cur)
    }
    for (const rec of receipts) {
      const detail = JSON.parse(rec.material_reconcile || '[]') as any[]
      for (const d of detail) {
        const cur = byItem.get(d.stock_item_id) || {
          stock_item_id: d.stock_item_id, item_name: d.item_name, unit: '',
          issued_qty: 0, issued_value: 0, consumed_qty: 0, returned_qty: 0, shortage_qty: 0
        }
        cur.consumed_qty += Number(d.consumed_qty) || 0
        cur.returned_qty += Number(d.returned_qty) || 0
        cur.shortage_qty += Number(d.shortage_qty) || 0
        byItem.set(d.stock_item_id, cur)
      }
    }

    const materials = Array.from(byItem.values()).map(m => ({
      ...m,
      outstanding_qty: Math.round((m.issued_qty - m.consumed_qty - m.returned_qty - m.shortage_qty) * 1000) / 1000
    }))

    const scrapTotal = receipts.reduce((s, r) => s + (Number(r.scrap_qty) || 0), 0)
    const shortageTotal = receipts.reduce((s, r) => s + (Number(r.shortage_qty) || 0), 0)

    res.json({
      success: true,
      data: {
        contract_id: contract.id,
        contract_number: contract.contract_number,
        status: contract.status,
        materials,
        pieces: {
          agreed_qty: contract.agreed_qty,
          received_qty: contract.received_qty,
          scrap_qty: scrapTotal,
          shortage_qty: shortageTotal,
        },
        issues, receipts,
      }
    })
  } catch (error) {
    console.error('Subcontract reconcile error:', error)
    res.status(500).json({ success: false, message: 'Failed to build reconcile summary' })
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
