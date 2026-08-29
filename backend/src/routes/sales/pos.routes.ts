import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { getLimits } from '../../services/subscription.service'
import { generateId, formatDocumentNumber } from '../../utils/id'
import { convertQuantityBidirectional, normalizeUnit } from '../../services/unitConversion.service'
import { ACC } from '../../config/accountCodes'
import { getOrCreateAccount } from '../../services/accounting.service'
import posStockService from '../../services/pos-stock.service'

const router = Router()

// Post a simple 2-line (debit/credit) journal entry + bump account_balances for
// both accounts. Shared by shift-close over/short and POS drawer cash movements —
// both are "one amount moves between two accounts" postings.
function postSimpleJournal(
  tenantId: string, userId: string, date: string,
  referenceType: string, referenceId: string, description: string,
  debitAccountId: string, creditAccountId: string, amount: number
): string {
  const entryNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(date).getFullYear(), 6)
  const entryId = generateId()
  const nowStr = new Date().toISOString()

  db.prepare(`
    INSERT INTO journal_entries (
      id, tenant_id, entry_number, date, reference_type, reference_id,
      description, total_debit, total_credit, is_auto_generated, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(entryId, tenantId, entryNumber, date, referenceType, referenceId, description, amount, amount, userId, nowStr)

  const insertLine = db.prepare(`
    INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insertLine.run(generateId(), tenantId, entryId, debitAccountId, 1, description, amount, 0)
  insertLine.run(generateId(), tenantId, entryId, creditAccountId, 2, description, 0, amount)

  const yr = parseInt(date.split('-')[0])
  const period = parseInt(date.split('-')[1])
  const bumpBalance = (accountId: string, debit: number, credit: number) => {
    const existing = db.prepare(`SELECT id FROM account_balances WHERE account_id = ? AND fiscal_year = ? AND period = ?`).get(accountId, yr, period)
    if (existing) {
      db.prepare(`
        UPDATE account_balances
        SET debit_amount = debit_amount + ?, credit_amount = credit_amount + ?,
            ending_balance = ending_balance + ? - ?
        WHERE account_id = ? AND fiscal_year = ? AND period = ?
      `).run(debit, credit, debit, credit, accountId, yr, period)
    } else {
      db.prepare(`
        INSERT INTO account_balances (id, tenant_id, account_id, fiscal_year, period, beginning_balance, debit_amount, credit_amount, ending_balance)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(generateId(), tenantId, accountId, yr, period, debit, credit, debit - credit)
    }
  }
  bumpBalance(debitAccountId, amount, 0)
  bumpBalance(creditAccountId, 0, amount)

  return entryId
}

// Sum PAID_OUT/CASH_IN drawer movements recorded during a shift.
function getShiftCashMovementTotals(tenantId: string, shiftId: string): { cashIn: number; paidOut: number } {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'CASH_IN' THEN amount ELSE 0 END), 0) as cash_in,
      COALESCE(SUM(CASE WHEN type = 'PAID_OUT' THEN amount ELSE 0 END), 0) as paid_out
    FROM pos_shift_cash_movements WHERE tenant_id = ? AND shift_id = ?
  `).get(tenantId, shiftId) as any
  return { cashIn: row?.cash_in || 0, paidOut: row?.paid_out || 0 }
}

// Sales inside a shift: prefer bills tagged with this shift_id (set at bill
// creation once a shift is open); fall back to the old opened_at time-range
// match for bills created before the shift_id column existed.
function getShiftSalesSummary(tenantId: string, shift: { id: string; opened_at: string }) {
  return db.prepare(`
    SELECT
      COUNT(*) as bill_count,
      COALESCE(SUM(b.total_amount), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN p.payment_method = 'CASH' THEN b.total_amount ELSE 0 END), 0) as cash_revenue,
      COALESCE(SUM(CASE WHEN p.payment_method != 'CASH' THEN b.total_amount ELSE 0 END), 0) as bank_revenue
    FROM pos_running_bills b
    LEFT JOIN pos_payments p ON b.id = p.bill_id
    WHERE b.tenant_id = ? AND b.status = 'PAID'
      AND (b.shift_id = ? OR (b.shift_id IS NULL AND b.closed_at >= ?))
  `).get(tenantId, shift.id, shift.opened_at) as any
}

// แปลงจำนวนตามสูตร (BOM/เมนู) ให้เป็นหน่วยฐาน (base_unit) ของวัตถุดิบก่อนคูณกับ
// unit_cost (unit_cost เก็บเป็น "ต่อ 1 หน่วยฐาน" เสมอ) — ใช้ตอนคำนวณ estimated COGS
// ปิดกะ ห้าม throw เพราะเส้นทางนี้ต้องปิดกะได้เสมอ ถ้าแปลงไม่ได้ให้ warn แล้วใช้เลขเดิม
// (pattern เดียวกับ bom.routes.ts:calculateBOMCost และ pos-accounting.service.ts:toBaseQty)
function posCogsToBaseQty(
  qty: number,
  recipeUnit: string | null | undefined,
  stockBaseUnit: string | null | undefined,
  tenantId: string,
  materialId: string | null | undefined,
  context: string
): number {
  const fromUnit = recipeUnit || stockBaseUnit || ''
  const toUnit = stockBaseUnit || fromUnit
  if (!fromUnit || !toUnit || normalizeUnit(fromUnit) === normalizeUnit(toUnit)) {
    return qty
  }
  const result = convertQuantityBidirectional(qty, fromUnit, toUnit, tenantId, materialId || undefined)
  if (result) {
    return result.converted
  }
  console.warn(`[qty] POS daily-sales COGS: no conversion ${fromUnit} → ${toUnit} for stock item ${materialId}; ${context} cost uses the unconverted quantity and is unreliable`)
  return qty
}

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
            SELECT bi.quantity, bi.unit as ingredient_unit, bi.material_id, si.unit_cost,
                   si.base_unit as stock_base_unit, si.unit as stock_unit
            FROM bom_items bi
            JOIN stock_items si ON bi.material_id = si.id
            WHERE bi.bom_id = ? AND bi.item_type = 'MATERIAL'
          `).all(item.bom_id) as any[]

          for (const bi of bomItems) {
            const qty = posCogsToBaseQty(
              bi.quantity,
              bi.ingredient_unit,
              bi.stock_base_unit || bi.stock_unit,
              tenantId,
              bi.material_id,
              `bill ${bill.id} bom ${item.bom_id} material ${bi.material_id}`
            )
            itemCost += (qty * bi.unit_cost)
          }
        } else {
          const ingItems = db.prepare(`
            SELECT pmi.quantity_used, pmi.unit_id, pmi.stock_item_id, si.unit_cost,
                   si.base_unit as stock_base_unit, si.unit as stock_unit
            FROM pos_menu_ingredients pmi
            JOIN stock_items si ON pmi.stock_item_id = si.id
            WHERE pmi.pos_menu_id = ?
          `).all(item.pos_menu_id) as any[]

          for (const ing of ingItems) {
            const qty = posCogsToBaseQty(
              ing.quantity_used,
              ing.unit_id,
              ing.stock_base_unit || ing.stock_unit,
              tenantId,
              ing.stock_item_id,
              `bill ${bill.id} menu ${item.pos_menu_id} stock item ${ing.stock_item_id}`
            )
            itemCost += (qty * ing.unit_cost)
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
    const sales = getShiftSalesSummary(tenantId, shift)
    const movements = getShiftCashMovementTotals(tenantId, shift.id)

    res.json({ success: true, data: { ...shift, live: { ...sales, cash_in: movements.cashIn, paid_out: movements.paidOut } } })
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

    // Subscription: จำกัดจำนวนกะที่เปิดพร้อมกันตามแพ็กเกจ (MASTER bypass)
    if (req.user!.role !== 'MASTER') {
      const { maxPosShifts } = getLimits(tenantId)
      if (maxPosShifts !== null) {
        const openCount = (db.prepare(`SELECT COUNT(*) as c FROM pos_shifts WHERE tenant_id = ? AND status = 'OPEN'`).get(tenantId) as any).c
        if (openCount >= maxPosShifts) {
          return res.status(403).json({
            success: false,
            code: 'POS_SHIFT_LIMIT',
            message: `แพ็กเกจนี้เปิดกะพร้อมกันได้ ${maxPosShifts} กะ กรุณาปิดกะก่อนหรืออัปเกรดแพ็กเกจ`,
          })
        }
      }
    }

    // ponytail: เช็คเดิม (ห้ามเปิดกะซ้อนเลย) ยังคงอยู่ — แพ็กเกจที่ max_pos_shifts IS NULL
    // (business/enterprise) ยังเปิดได้ทีละ 1 กะจนกว่า UI จะรองรับหลายกะ
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
    const sales = getShiftSalesSummary(tenantId, shift)
    const movements = getShiftCashMovementTotals(tenantId, id)

    const expectedCash = (shift.opening_cash || 0) + (sales.cash_revenue || 0) + movements.cashIn - movements.paidOut
    const cashDifference = closing_cash_counted - expectedCash
    const nowStr = new Date().toISOString()
    const today = nowStr.split('T')[0]

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

    // Post เงินขาด/เงินเกิน เข้าบัญชีทันทีที่ปิดกะ (ข้ามถ้าเท่ากันพอดี) — ป้องกันลงซ้ำ
    // อัตโนมัติเพราะ UPDATE ด้านบนใช้ WHERE status='OPEN' เท่านั้น กดปิดซ้ำจะเจอ 404
    // ก่อนถึงจุดนี้เสมอ (shift ถูกเปลี่ยนเป็น CLOSED ไปแล้วในรอบแรก)
    let journalEntryId: string | null = null
    if (Math.abs(cashDifference) > 0.005) {
      const cashAccountId = getOrCreateAccount(tenantId, ACC.CASH)
      const overShortAccountId = getOrCreateAccount(tenantId, '5901', 'เงินขาด/เงินเกิน', 'EXPENSE', 'OTHER_EXPENSE')
      const desc = `ปิดกะ ${shift.shift_number} — ${cashDifference < 0 ? 'เงินขาด' : 'เงินเกิน'} ${Math.abs(cashDifference).toFixed(2)} บาท`
      journalEntryId = cashDifference < 0
        // เงินขาด: Dr 5901 / Cr เงินสด
        ? postSimpleJournal(tenantId, userId, today, 'POS_SHIFT_CLOSE', id, desc, overShortAccountId, cashAccountId, Math.abs(cashDifference))
        // เงินเกิน: Dr เงินสด / Cr 5901
        : postSimpleJournal(tenantId, userId, today, 'POS_SHIFT_CLOSE', id, desc, cashAccountId, overShortAccountId, cashDifference)
    }

    res.json({
      success: true,
      message: 'ปิดกะสำเร็จ',
      data: {
        shift_number: shift.shift_number,
        total_revenue: sales.total_revenue,
        cash_revenue: sales.cash_revenue,
        bank_revenue: sales.bank_revenue,
        bill_count: sales.bill_count,
        cash_in: movements.cashIn,
        paid_out: movements.paidOut,
        expected_cash: expectedCash,
        closing_cash_counted,
        cash_difference: cashDifference,
        journal_entry_id: journalEntryId
      }
    })
  } catch (error) {
    console.error('Close shift error:', error)
    res.status(500).json({ success: false, message: 'Failed to close shift' })
  }
})

// GET cash movements (PAID_OUT/CASH_IN) for a shift
router.get('/pos-shifts/:id/cash-movements', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params
    const rows = db.prepare(`
      SELECT m.*, a.name as account_name, a.code as account_code, u.name as created_by_name
      FROM pos_shift_cash_movements m
      LEFT JOIN accounts a ON m.account_id = a.id
      LEFT JOIN users u ON m.created_by = u.id
      WHERE m.shift_id = ? AND m.tenant_id = ?
      ORDER BY m.created_at ASC
    `).all(id, tenantId)
    res.json({ success: true, data: rows })
  } catch (error) {
    console.error('Get shift cash movements error:', error)
    res.status(500).json({ success: false, message: 'Failed to get cash movements' })
  }
})

// POST cash movement (paid-out / cash-in) — เงินเข้า/ออกลิ้นชักระหว่างกะ
// RBAC: ห้ามปล่อยให้ role USER ธรรมดาดึงเงินออกจากลิ้นชักได้เอง (แพทเทิร์นเดียวกับ
// purchase.routes.ts ที่เช็คก่อน cancel ใบขอซื้อ)
router.post('/pos-shifts/:id/cash-movement', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const { id } = req.params
    const { type, amount, reason, account_id } = req.body

    if (!['ADMIN', 'MANAGER', 'MASTER', 'POWERUSER'].includes(req.user!.role)) {
      return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์บันทึกเงินเข้า/ออกลิ้นชัก — ต้องเป็น ADMIN/MANAGER/MASTER/POWERUSER' })
    }

    if (type !== 'PAID_OUT' && type !== 'CASH_IN') {
      return res.status(400).json({ success: false, message: 'ประเภทไม่ถูกต้อง (ต้องเป็น PAID_OUT หรือ CASH_IN)' })
    }
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุจำนวนเงินให้ถูกต้อง' })
    }
    if (!account_id) {
      return res.status(400).json({ success: false, message: 'กรุณาเลือกบัญชี' })
    }

    const shift = db.prepare(`SELECT * FROM pos_shifts WHERE id = ? AND tenant_id = ? AND status = 'OPEN'`).get(id, tenantId) as any
    if (!shift) return res.status(404).json({ success: false, message: 'ไม่พบกะที่เปิดอยู่ — ต้องเปิดกะก่อนบันทึกเงินเข้า/ออก' })

    const account = db.prepare(`SELECT id FROM accounts WHERE id = ? AND tenant_id = ?`).get(account_id, tenantId)
    if (!account) return res.status(400).json({ success: false, message: 'ไม่พบบัญชีที่เลือก' })

    const nowStr = new Date().toISOString()
    const movementId = generateId()
    db.prepare(`
      INSERT INTO pos_shift_cash_movements (id, tenant_id, shift_id, type, amount, reason, account_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(movementId, tenantId, id, type, amt, reason || null, account_id, userId, nowStr)

    const cashAccountId = getOrCreateAccount(tenantId, ACC.CASH)
    const today = nowStr.split('T')[0]
    const desc = `${type === 'PAID_OUT' ? 'จ่ายออกจากลิ้นชัก' : 'รับเข้าลิ้นชัก'} กะ ${shift.shift_number}${reason ? ' - ' + reason : ''}`
    const journalEntryId = type === 'PAID_OUT'
      // จ่ายออก: Dr บัญชีค่าใช้จ่ายที่เลือก / Cr เงินสด
      ? postSimpleJournal(tenantId, userId, today, 'POS_CASH_MOVEMENT', movementId, desc, account_id, cashAccountId, amt)
      // รับเข้า: Dr เงินสด / Cr บัญชีที่เลือก
      : postSimpleJournal(tenantId, userId, today, 'POS_CASH_MOVEMENT', movementId, desc, cashAccountId, account_id, amt)

    res.json({ success: true, message: 'บันทึกสำเร็จ', data: { id: movementId, type, amount: amt, journal_entry_id: journalEntryId } })
  } catch (error) {
    console.error('POS cash movement error:', error)
    res.status(500).json({ success: false, message: 'Failed to record cash movement' })
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
      UPDATE pos_running_bills
      SET status = 'VOID', notes = TRIM(COALESCE(notes, '') || ' ' || ?)
      WHERE id = ? AND tenant_id = ?
    `).run(voidNote, id, tenantId)

    // คืนสต็อกกลับ (ใบขายคืน = สต็อกเพิ่ม) — ใช้ฟังก์ชันร่วมกับ CANCEL ใน
    // pos-stock.service.ts กันคืนซ้ำด้วย pos_stock_deductions.returned เอง
    const stockReturnResult = await posStockService.returnStockOnCancel(id, tenantId, userId, reason)
    if (!stockReturnResult.success) {
      console.warn(`[pos-void] stock return warnings for bill ${id}:`, stockReturnResult.errors)
    }

    // ponytail: กลับรายการด้วยการสลับ debit<->credit ของ journal เดิม (POS_SALE + POS_COGS)
    // ของบิลนี้ทั้งหมด แทนการ re-derive VAT/COGS/บัญชีเงินสด-ธนาคารเอง — ได้ mirror image
    // เป๊ะเสมอ แม้ขาขายใน pos-accounting.service.ts จะเปลี่ยน logic ในอนาคต
    const saleLines = db.prepare(`
      SELECT jl.account_id, jl.debit, jl.credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.tenant_id = ? AND je.reference_id = ?
        AND je.reference_type IN ('POS_SALE', 'POS_COGS')
      ORDER BY je.reference_type DESC, jl.line_number
    `).all(tenantId, id) as Array<{ account_id: string; debit: number; credit: number }>

    const date = nowStr.split('T')[0]

    if (saleLines.length === 0) {
      // บิลเก่าที่ไม่เคยลงบัญชี — ไม่มีอะไรให้กลับ อย่าสร้าง entry ปลอม
      console.warn(`[pos-void] bill ${id} has no POS_SALE/POS_COGS journal; skipping reversal entry`)
      return res.json({
        success: true,
        message: `ยกเลิกบิล ${bill.bill_number} สำเร็จ (ไม่พบรายการบัญชีเดิม จึงไม่มีการกลับรายการ)`,
        data: { bill_id: id, bill_number: bill.bill_number, amount: bill.total_amount, void_note: voidNote, reversed: false }
      })
    }

    const reversalTotal = saleLines.reduce((s, l) => s + (l.debit || 0), 0)
    const year = new Date().getFullYear()
    const entryNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', year, 6)
    const entryId = generateId()

    db.prepare(`
      INSERT INTO journal_entries (
        id, tenant_id, entry_number, date, reference_type, reference_id,
        description, total_debit, total_credit, is_auto_generated, created_by, created_at, business_unit
      ) VALUES (?, ?, ?, ?, 'POS_VOID', ?, ?, ?, ?, 1, ?, ?, 'RETAIL')
    `).run(
      entryId, tenantId, entryNumber, date, id,
      `ยกเลิกบิล ${bill.bill_number}${reason ? ' - ' + reason : ''}`,
      reversalTotal, reversalTotal, userId, nowStr
    )

    const insertLine = db.prepare(`
      INSERT INTO journal_lines (id, tenant_id, journal_entry_id, account_id, line_number, description, debit, credit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    // อัปเดต account_balances ด้วย account_id ตรงๆ (บัญชีเงินสด/ธนาคารอาจเป็น sub-account
    // ที่ผูกกับ bank_accounts จึงหาด้วย code ไม่ได้)
    const balYear = parseInt(date.split('-')[0])
    const balPeriod = parseInt(date.split('-')[1])
    const updateBal = (accountId: string, debit: number, credit: number) => {
      const existing = db.prepare(`
        SELECT id FROM account_balances WHERE account_id = ? AND fiscal_year = ? AND period = ?
      `).get(accountId, balYear, balPeriod)
      if (existing) {
        db.prepare(`
          UPDATE account_balances
          SET debit_amount = debit_amount + ?, credit_amount = credit_amount + ?,
              ending_balance = ending_balance + ? - ?
          WHERE account_id = ? AND fiscal_year = ? AND period = ?
        `).run(debit, credit, debit, credit, accountId, balYear, balPeriod)
      } else {
        db.prepare(`
          INSERT INTO account_balances (id, tenant_id, account_id, fiscal_year, period, beginning_balance, debit_amount, credit_amount, ending_balance)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        `).run(generateId(), tenantId, accountId, balYear, balPeriod, debit, credit, debit - credit)
      }
    }

    saleLines.forEach((l, i) => {
      const debit = l.credit || 0
      const credit = l.debit || 0
      insertLine.run(
        generateId(), tenantId, entryId, l.account_id, i + 1,
        `กลับรายการยกเลิกบิล ${bill.bill_number}`, debit, credit
      )
      updateBal(l.account_id, debit, credit)
    })

    res.json({
      success: true,
      message: `ยกเลิกบิล ${bill.bill_number} สำเร็จ`,
      data: { bill_id: id, bill_number: bill.bill_number, amount: bill.total_amount, void_note: voidNote, stock_returns: stockReturnResult.returns.length }
    })
  } catch (error) {
    console.error('Void bill error:', error)
    res.status(500).json({ success: false, message: 'ยกเลิกบิลไม่สำเร็จ' })
  }
})

export default router
