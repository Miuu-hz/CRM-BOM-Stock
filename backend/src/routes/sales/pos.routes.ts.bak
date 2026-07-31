import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { generateId, formatDocumentNumber } from '../../utils/id'

const router = Router()

// ============================================
// POS DAILY SALES SUMMARY (Z-Report)
// ============================================

// GET all POS daily sales summaries
router.get('/pos-daily-sales', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { date_from, date_to, limit = 50 } = req.query

    let query = `
      SELECT 
        ds.*,
        u.name as closed_by_name,
        COUNT(dsb.id) as bill_count
      FROM pos_daily_sales ds
      LEFT JOIN users u ON ds.closed_by = u.id
      LEFT JOIN pos_daily_sales_bills dsb ON ds.id = dsb.daily_sales_id
      WHERE ds.tenant_id = ?
    `
    const params: any[] = [tenantId]

    if (date_from) {
      query += ' AND ds.sales_date >= ?'
      params.push(date_from)
    }

    if (date_to) {
      query += ' AND ds.sales_date <= ?'
      params.push(date_to)
    }

    query += ' GROUP BY ds.id ORDER BY ds.sales_date DESC LIMIT ?'
    params.push(parseInt(limit as string))

    const summaries = db.prepare(query).all(...params)

    res.json({ success: true, data: summaries })
  } catch (error) {
    console.error('Get POS daily sales error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch daily sales' })
  }
})

// GET pending bills for daily sales (bills not yet included in any summary)
// IMPORTANT: must be defined BEFORE /pos-daily-sales/:id to avoid route collision
router.get('/pos-daily-sales/pending-bills', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId

    const bills = (db.prepare(`
      SELECT
        b.id,
        b.bill_number,
        b.display_name,
        b.total_amount,
        b.closed_at,
        p.payment_method
      FROM pos_running_bills b
      JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.tenant_id = ?
        AND b.status = 'PAID'
        AND b.id NOT IN (
          SELECT bill_id FROM pos_daily_sales_bills
        )
      ORDER BY b.closed_at DESC
      LIMIT 100
    `).all(tenantId) as any[])

    res.json({ success: true, data: bills })
  } catch (error) {
    console.error('Get pending bills error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pending bills' })
  }
})

// GET single POS daily sales summary with details
router.get('/pos-daily-sales/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    // Get summary
    const summary = db.prepare(`
      SELECT ds.*, u.name as closed_by_name
      FROM pos_daily_sales ds
      LEFT JOIN users u ON ds.closed_by = u.id
      WHERE ds.id = ? AND ds.tenant_id = ?
    `).get(id, tenantId)

    if (!summary) {
      return res.status(404).json({ success: false, message: 'Daily sales summary not found' })
    }

    // Get linked bills
    const bills = db.prepare(`
      SELECT 
        b.bill_number,
        b.display_name,
        b.total_amount,
        b.closed_at,
        p.payment_method
      FROM pos_daily_sales_bills dsb
      JOIN pos_running_bills b ON dsb.bill_id = b.id
      LEFT JOIN pos_payments p ON b.id = p.bill_id
      WHERE dsb.daily_sales_id = ?
      ORDER BY b.closed_at ASC
    `).all(id)

    // Get sales by product
    const products = db.prepare(`
      SELECT 
        bi.product_name,
        SUM(bi.quantity) as total_qty,
        SUM(bi.total_price) as total_amount,
        p.category as product_category
      FROM pos_daily_sales_bills dsb
      JOIN pos_running_bills b ON dsb.bill_id = b.id
      JOIN pos_bill_items bi ON b.id = bi.bill_id
      LEFT JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
      LEFT JOIN products p ON pmc.product_id = p.id
      WHERE dsb.daily_sales_id = ?
      GROUP BY bi.product_name
      ORDER BY total_amount DESC
    `).all(id)

    // Get payment breakdown
    const payments = db.prepare(`
      SELECT 
        p.payment_method,
        COUNT(*) as count,
        SUM(p.amount) as total_amount
      FROM pos_daily_sales_bills dsb
      JOIN pos_running_bills b ON dsb.bill_id = b.id
      JOIN pos_payments p ON b.id = p.bill_id
      WHERE dsb.daily_sales_id = ?
      GROUP BY p.payment_method
    `).all(id)

    res.json({
      success: true,
      data: {
        ...summary,
        bills,
        products,
        payments
      }
    })
  } catch (error) {
    console.error('Get POS daily sales detail error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch daily sales detail' })
  }
})

// POST create daily sales summary (Close Day)
router.post('/pos-daily-sales', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const { sales_date, notes } = req.body

    const targetDate = sales_date || new Date().toISOString().split('T')[0]

    // Check if already closed for this date
    const existingCheck = db.prepare(`
      SELECT id FROM pos_daily_sales 
      WHERE tenant_id = ? AND sales_date = ?
    `).get(tenantId, targetDate)

    if (existingCheck) {
      return res.status(400).json({ 
        success: false, 
        message: 'This date has already been closed. Please use a different date.' 
      })
    }

    // Get all paid bills not yet included in any summary (regardless of date)
    // User selects the sales_date for the shift — don't filter by closed_at date
    const bills = db.prepare(`
      SELECT
        b.*,
        p.payment_method,
        p.amount as payment_amount
      FROM pos_running_bills b
      JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.tenant_id = ?
        AND b.status = 'PAID'
        AND b.id NOT IN (
          SELECT bill_id FROM pos_daily_sales_bills
        )
    `).all(tenantId) as any[]

    if (bills.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'ไม่มีบิลที่ชำระแล้วที่รอปิดกะ'
      })
    }

    // Calculate totals
    let totalRevenue = 0
    let totalTax = 0
    let totalServiceCharge = 0
    let totalDiscount = 0
    let estimatedCOGS = 0

    // Payment method breakdown
    const paymentBreakdown: Record<string, number> = {}

    for (const bill of bills) {
      totalRevenue += bill.total_amount
      totalTax += bill.tax_amount || 0
      totalServiceCharge += bill.service_charge_amount || 0
      totalDiscount += bill.discount_amount || 0

      // Calculate estimated COGS from bill items
      const items = db.prepare(`
        SELECT bi.*, pmc.bom_id
        FROM pos_bill_items bi
        LEFT JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id
        WHERE bi.bill_id = ?
      `).all(bill.id) as any[]

      for (const item of items) {
        let itemCost = 0

        if (item.bom_id) {
          const bomItems = db.prepare(`
            SELECT bi.quantity, si.unit_cost
            FROM bom_items bi
            JOIN stock_items si ON bi.material_id = si.id
            WHERE bi.bom_id = ? AND bi.item_type = 'MATERIAL'
          `).all(item.bom_id) as any[]

          for (const bi of bomItems) {
            itemCost += (bi.quantity * bi.unit_cost)
          }
        } else {
          const ingItems = db.prepare(`
            SELECT pmi.quantity_used, si.unit_cost
            FROM pos_menu_ingredients pmi
            JOIN stock_items si ON pmi.stock_item_id = si.id
            WHERE pmi.pos_menu_id = ?
          `).all(item.pos_menu_id) as any[]

          for (const ing of ingItems) {
            itemCost += (ing.quantity_used * ing.unit_cost)
          }
        }

        estimatedCOGS += (itemCost * item.quantity)
      }

      // Payment breakdown
      const method = bill.payment_method || 'CASH'
      paymentBreakdown[method] = (paymentBreakdown[method] || 0) + bill.payment_amount
    }

    const netProfit = totalRevenue - estimatedCOGS

    // Generate summary number
    const summaryNumber = formatDocumentNumber('POS-SUM', tenantId, 'POS_DAILY_SALES', targetDate.replace(/-/g, ''), 3)

    // Create summary
    const summaryId = generateId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO pos_daily_sales (
        id, tenant_id, summary_number, sales_date,
        total_revenue, total_tax, total_service_charge, total_discount,
        estimated_cogs, net_profit,
        cash_amount, bank_amount, other_amount,
        bill_count, notes, closed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      summaryId,
      tenantId,
      summaryNumber,
      targetDate,
      totalRevenue,
      totalTax,
      totalServiceCharge,
      totalDiscount,
      estimatedCOGS,
      netProfit,
      paymentBreakdown['CASH'] || 0,
      paymentBreakdown['QR_CODE'] || paymentBreakdown['TRANSFER'] || 0,
      paymentBreakdown['CREDIT_CARD'] || 0,
      bills.length,
      notes || null,
      userId,
      now
    )

    // Link bills to summary
    const linkStmt = db.prepare(`
      INSERT INTO pos_daily_sales_bills (id, tenant_id, daily_sales_id, bill_id, amount)
      VALUES (?, ?, ?, ?, ?)
    `)

    for (const bill of bills) {
      linkStmt.run(generateId(), tenantId, summaryId, bill.id, bill.total_amount)
    }

    res.json({
      success: true,
      message: 'Daily sales summary created successfully',
      data: {
        id: summaryId,
        summary_number: summaryNumber,
        sales_date: targetDate,
        total_revenue: totalRevenue,
        estimated_cogs: estimatedCOGS,
        net_profit: netProfit,
        bill_count: bills.length
      }
    })
  } catch (error) {
    console.error('Create POS daily sales error:', error)
    res.status(500).json({ success: false, message: 'Failed to create daily sales summary' })
  }
})

// ============================================
// POS SHIFTS (เปิด/ปิดกะ)
// ============================================

// GET current open shift
router.get('/pos-shifts/current', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const shift = db.prepare(`
      SELECT s.*, u.name as opened_by_name
      FROM pos_shifts s
      LEFT JOIN users u ON s.opened_by = u.id
      WHERE s.tenant_id = ? AND s.status = 'OPEN'
      ORDER BY s.opened_at DESC LIMIT 1
    `).get(tenantId) as any

    if (!shift) return res.json({ success: true, data: null })

    // Attach current sales summary from bills since shift opened
    const sales = db.prepare(`
      SELECT
        COUNT(*) as bill_count,
        COALESCE(SUM(b.total_amount), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN p.payment_method = 'CASH' THEN b.total_amount ELSE 0 END), 0) as cash_revenue,
        COALESCE(SUM(CASE WHEN p.payment_method != 'CASH' THEN b.total_amount ELSE 0 END), 0) as bank_revenue
      FROM pos_running_bills b
      LEFT JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.tenant_id = ? AND b.status = 'PAID' AND b.closed_at >= ?
    `).get(tenantId, shift.opened_at) as any

    res.json({ success: true, data: { ...shift, live: sales } })
  } catch (error) {
    console.error('Get current shift error:', error)
    res.status(500).json({ success: false, message: 'Failed to get current shift' })
  }
})

// GET shift list
router.get('/pos-shifts', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { limit = 20 } = req.query
    const shifts = db.prepare(`
      SELECT s.*, uo.name as opened_by_name, uc.name as closed_by_name
      FROM pos_shifts s
      LEFT JOIN users uo ON s.opened_by = uo.id
      LEFT JOIN users uc ON s.closed_by = uc.id
      WHERE s.tenant_id = ?
      ORDER BY s.opened_at DESC
      LIMIT ?
    `).all(tenantId, parseInt(limit as string)) as any[]

    res.json({ success: true, data: shifts })
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get shifts' })
  }
})

// POST open shift
router.post('/pos-shifts/open', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const { opening_cash, notes } = req.body

    if (opening_cash === undefined || opening_cash === null) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุเงินสดเปิดกะ' })
    }

    // Check no open shift already
    const existing = db.prepare(`SELECT id FROM pos_shifts WHERE tenant_id = ? AND status = 'OPEN'`).get(tenantId)
    if (existing) {
      return res.status(400).json({ success: false, message: 'มีกะที่เปิดอยู่แล้ว กรุณาปิดกะก่อน' })
    }

    const shiftNumber = formatDocumentNumber('SHIFT', tenantId, 'POS_SHIFT', new Date().getFullYear(), 4)
    const id = generateId()
    const nowStr = new Date().toISOString()

    db.prepare(`
      INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by, notes, created_at)
      VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)
    `).run(id, tenantId, shiftNumber, nowStr, opening_cash, userId, notes || null, nowStr)

    res.json({ success: true, message: 'เปิดกะสำเร็จ', data: { id, shift_number: shiftNumber, opened_at: nowStr } })
  } catch (error) {
    console.error('Open shift error:', error)
    res.status(500).json({ success: false, message: 'Failed to open shift' })
  }
})

// POST close shift
router.post('/pos-shifts/:id/close', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const { id } = req.params
    const { closing_cash_counted, notes } = req.body

    if (closing_cash_counted === undefined || closing_cash_counted === null) {
      return res.status(400).json({ success: false, message: 'กรุณานับและกรอกเงินสดในลิ้นชัก' })
    }

    const shift = db.prepare(`SELECT * FROM pos_shifts WHERE id = ? AND tenant_id = ? AND status = 'OPEN'`).get(id, tenantId) as any
    if (!shift) return res.status(404).json({ success: false, message: 'ไม่พบกะที่เปิดอยู่' })

    // Calculate sales in this shift
    const sales = db.prepare(`
      SELECT
        COUNT(*) as bill_count,
        COALESCE(SUM(b.total_amount), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN p.payment_method = 'CASH' THEN b.total_amount ELSE 0 END), 0) as cash_revenue,
        COALESCE(SUM(CASE WHEN p.payment_method != 'CASH' THEN b.total_amount ELSE 0 END), 0) as bank_revenue
      FROM pos_running_bills b
      LEFT JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.tenant_id = ? AND b.status = 'PAID' AND b.closed_at >= ?
    `).get(tenantId, shift.opened_at) as any

    const expectedCash = (shift.opening_cash || 0) + (sales.cash_revenue || 0)
    const cashDifference = closing_cash_counted - expectedCash
    const nowStr = new Date().toISOString()

    db.prepare(`
      UPDATE pos_shifts SET
        status = 'CLOSED', closed_at = ?,
        closing_cash_counted = ?, expected_cash = ?, cash_difference = ?,
        total_revenue = ?, cash_revenue = ?, bank_revenue = ?,
        bill_count = ?, closed_by = ?,
        notes = COALESCE(?, notes)
      WHERE id = ? AND tenant_id = ?
    `).run(
      nowStr, closing_cash_counted, expectedCash, cashDifference,
      sales.total_revenue, sales.cash_revenue, sales.bank_revenue,
      sales.bill_count, userId, notes || null, id, tenantId
    )

    res.json({
      success: true,
      message: 'ปิดกะสำเร็จ',
      data: {
        shift_number: shift.shift_number,
        total_revenue: sales.total_revenue,
        cash_revenue: sales.cash_revenue,
        bank_revenue: sales.bank_revenue,
        bill_count: sales.bill_count,
        expected_cash: expectedCash,
        closing_cash_counted,
        cash_difference: cashDifference
      }
    })
  } catch (error) {
    console.error('Close shift error:', error)
    res.status(500).json({ success: false, message: 'Failed to close shift' })
  }
})

// ============================================
// POS BILL VOID
// ============================================

// Void a paid POS bill (only if not yet cleared)
router.post('/pos-running-bills/:id/void', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const { id } = req.params
    const { reason } = req.body

    const bill = db.prepare(`
      SELECT b.*, p.payment_method
      FROM pos_running_bills b
      LEFT JOIN pos_payments p ON b.id = p.bill_id
      WHERE b.id = ? AND b.tenant_id = ?
    `).get(id, tenantId) as any

    if (!bill) {
      return res.status(404).json({ success: false, message: 'ไม่พบบิล' })
    }
    if (bill.status !== 'PAID') {
      return res.status(400).json({ success: false, message: 'ยกเลิกได้เฉพาะบิลที่ชำระแล้วเท่านั้น' })
    }

    const alreadyCleared = db.prepare(`
      SELECT id FROM pos_clearing_transfer_items WHERE bill_id = ? AND tenant_id = ?
    `).get(id, tenantId)
    if (alreadyCleared) {
      return res.status(400).json({ success: false, message: 'บิลนี้นำเงินเข้าบัญชีแล้ว ไม่สามารถยกเลิกได้' })
    }

    const nowStr = new Date().toISOString()
    const voidNote = reason ? `[VOID] ${reason}` : '[VOID]'

    db.prepare(`
      UPDATE pos_running_bills SET status = 'VOID', updated_at = ? WHERE id = ? AND tenant_id = ?
    `).run(nowStr, id, tenantId)

    // Reversal journal: Dr. Revenue 4100, Cr. Clearing 1180
    const getOrCreate = (code: string, name: string, type: string, category: string, normalBalance: string) => {
      const existing = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?').get(code, tenantId) as any
      if (existing) return existing.id
      const newId = generateId()
      db.prepare(`
        INSERT INTO accounts (id, tenant_id, code, name, type, category, normal_balance, is_active, is_system)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
      `).run(newId, tenantId, code, name, type, category, normalBalance)
      return newId
    }

    const year = new Date().getFullYear()
    const entryNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', year, 6)
    const entryId = generateId()
    const date = nowStr.split('T')[0]

    db.prepare(`
      INSERT INTO journal_entries (
        id, tenant_id, entry_number, date, reference_type, reference_id,
        description, total_debit, total_credit, is_auto_generated, created_by, created_at, business_unit
      ) VALUES (?, ?, ?, ?, 'POS_VOID', ?, ?, ?, ?, 1, ?, ?, 'RETAIL')
    `).run(
      entryId, tenantId, entryNumber, date, id,
      `ยกเลิกบิล ${bill.bill_number}${reason ? ' - ' + reason : ''}`,
      bill.total_amount, bill.total_amount, userId, nowStr
    )

    const revenueId = getOrCreate('4100', 'รายได้ขาย', 'REVENUE', 'REVENUE', 'CREDIT')
    const clearingId = getOrCreate('1180', 'ลูกหนี้การค้า-POS', 'ASSET', 'CURRENT_ASSET', 'DEBIT')

    db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, 1, ?, ?, 0)
    `).run(generateId(), tenantId, entryId, revenueId, `ยกเลิกบิล ${bill.bill_number}`, bill.total_amount)

    db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, 2, ?, 0, ?)
    `).run(generateId(), tenantId, entryId, clearingId, `ยกเลิก Clearing ${bill.bill_number}`, bill.total_amount)

    // Update account balances (reverse)
    const updateBal = (code: string, debit: number, credit: number) => {
      const yr = parseInt(date.split('-')[0])
      const mo = parseInt(date.split('-')[1])
      const acc = db.prepare('SELECT id FROM accounts WHERE code = ? AND tenant_id = ?').get(code, tenantId) as any
      if (!acc) return
      const existing = db.prepare(`
        SELECT id FROM account_balances WHERE account_id = ? AND fiscal_year = ? AND period = ?
      `).get(acc.id, yr, mo)
      if (existing) {
        db.prepare(`
          UPDATE account_balances
          SET debit_amount = debit_amount + ?, credit_amount = credit_amount + ?,
              ending_balance = ending_balance + ? - ?
          WHERE account_id = ? AND fiscal_year = ? AND period = ?
        `).run(debit, credit, debit, credit, acc.id, yr, mo)
      } else {
        db.prepare(`
          INSERT INTO account_balances (id, tenant_id, account_id, fiscal_year, period, beginning_balance, debit_amount, credit_amount, ending_balance)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        `).run(generateId(), tenantId, acc.id, yr, mo, debit, credit, debit - credit)
      }
    }

    updateBal('4100', bill.total_amount, 0)  // Dr. Revenue (reduces net revenue)
    updateBal('1180', 0, bill.total_amount)  // Cr. Clearing (reduces receivable)

    res.json({
      success: true,
      message: `ยกเลิกบิล ${bill.bill_number} สำเร็จ`,
      data: { bill_id: id, bill_number: bill.bill_number, amount: bill.total_amount, void_note: voidNote }
    })
  } catch (error) {
    console.error('Void bill error:', error)
    res.status(500).json({ success: false, message: 'ยกเลิกบิลไม่สำเร็จ' })
  }
})

export default router
