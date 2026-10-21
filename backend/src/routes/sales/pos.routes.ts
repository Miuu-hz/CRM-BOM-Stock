import { Router, Request, Response } from 'express'
import db from '../../db/sqlite'
import { getLimits } from '../../services/subscription.service'
import { generateId, formatDocumentNumber, thaiDateStr } from '../../utils/id'
import posAccountingService from '../../services/pos-accounting.service'
import { ACC } from '../../config/accountCodes'
import { postJournal, getOrCreateAccount, JournalError } from '../../services/accounting.service'
import { cancelPosBill } from '../../services/posBillCancel.service'
import { gateOrCreate, recordAutoAction } from '../../services/approvalGate.service'
import { buildShiftSummary } from '../../services/posShiftSummary.service'
import posStockService from '../../services/pos-stock.service'
import { buildShiftCloseJournal } from '../../services/posShiftRepair.service'

const router = Router()

// Post a simple 2-line (debit/credit) journal entry + bump account_balances for
// both accounts. Shared by shift-close over/short and POS drawer cash movements —
// both are "one amount moves between two accounts" postings.
function postSimpleJournal(
  tenantId: string, userId: string, date: string,
  referenceType: string, referenceId: string, description: string,
  debitAccountId: string, creditAccountId: string, amount: number
): string {
  const entryNumber = formatDocumentNumber('JV', tenantId, 'JOURNAL', new Date(date).getFullYear(), 5, date)
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

/**
 * เงินออกจากลิ้นชักที่ยังไม่มีบิล — Dr 1182 เงินจ่ายจาก POS รอจับคู่บิล / Cr เงินสด
 * ยอดค้างใน 1182 จะถูกปิดตอนบันทึกจ่ายเงินผู้ขายด้วยวิธี "เงินจาก POS" (paySupplier, POS_CASH)
 * OPENING_GAP = เงินที่หายไประหว่างปิดกะก่อนกับเปิดกะนี้ (ไม่นับใน expected_cash ของกะ)
 */
function recordPosPayoutPending(
  tenantId: string, userId: string, shift: { id: string; shift_number: string },
  type: 'PAID_OUT' | 'OPENING_GAP', amount: number, reason: string, nowStr: string,
): string {
  const movementId = generateId()
  const pendingAccId = getOrCreateAccount(tenantId, ACC.POS_PAYOUT_PENDING)
  db.prepare(`
    INSERT INTO pos_shift_cash_movements (id, tenant_id, shift_id, type, amount, reason, account_id, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(movementId, tenantId, shift.id, type, amount, reason, pendingAccId, userId, nowStr)
  const label = type === 'OPENING_GAP' ? 'เงินออกจากลิ้นชักก่อนเปิด' : 'จ่ายออกจากลิ้นชัก'
  postSimpleJournal(tenantId, userId, thaiDateStr(), 'POS_CASH_MOVEMENT', movementId,
    `${label} กะ ${shift.shift_number} - ${reason}`, pendingAccId, getOrCreateAccount(tenantId, ACC.CASH), amount)
  return movementId
}

// Sales inside a shift: prefer bills tagged with this shift_id (set at bill
// creation once a shift is open); fall back to the old opened_at time-range
// match for bills created before the shift_id column existed.
// ยอดเงินสด/โอนรวมยอดต่อบิลก่อน (subquery) — เดิม LEFT JOIN pos_payments ตรง ๆ บิลที่มี payment 2 แถว
// ถูกนับยอดบิลซ้ำ 2 เท่า · แบ่งยอดบิลตามสัดส่วนที่จ่ายแต่ละช่องทาง (CASH = เงินสด, อื่น ๆ = ธนาคาร เหมือนเดิม)
// แถวซ้ำ/จ่ายแยกหลายช่องทางจึงรวมได้ไม่เกินยอดบิล · บิลไม่มี payment เลย = ไม่เข้าทั้งสองฝั่ง (ผู้ปิดกะเตือนเอง)
function getShiftSalesSummary(tenantId: string, shift: { id: string; opened_at: string }) {
  return db.prepare(`
    SELECT
      COUNT(*) as bill_count,
      COALESCE(SUM(x.total_amount), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN x.paid > 0 THEN x.total_amount * x.cash_paid / x.paid ELSE 0 END), 0) as cash_revenue,
      COALESCE(SUM(CASE WHEN x.paid > 0 THEN x.total_amount * (x.paid - x.cash_paid) / x.paid ELSE 0 END), 0) as bank_revenue
    FROM (
      SELECT b.total_amount,
        (SELECT SUM(p.amount) FROM pos_payments p WHERE p.bill_id = b.id) as paid,
        (SELECT SUM(CASE WHEN p.payment_method = 'CASH' THEN p.amount ELSE 0 END) FROM pos_payments p WHERE p.bill_id = b.id) as cash_paid
      FROM pos_running_bills b
      WHERE b.tenant_id = ? AND b.status = 'PAID'
        AND (b.shift_id = ? OR (b.shift_id IS NULL AND b.closed_at >= ?))
    ) x
  `).get(tenantId, shift.id, shift.opened_at) as any
}

// ============================================
// POS DAILY SALES SUMMARY (Z-Report)
// ============================================

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const BANK_METHODS = new Set(['QR_CODE', 'TRANSFER'])

interface ZBill {
  id: string
  total_amount: number
  tax_amount: number | null
  service_charge_amount: number | null
  discount_amount: number | null
}

// ยอดรวม Z-report จากบิลชุดหนึ่ง — ใช้ทั้งตอนสร้างสรุป (POST) และตอนคำนวณใหม่เมื่อบิลถูก void ทีหลัง (GET :id)
// ช่องทางชำระ: แบ่งยอดบิลตามสัดส่วนที่จ่ายแต่ละช่องทาง (แบบ getShiftSalesSummary) ให้ cash+bank+other = total เสมอ
// CASH = เงินสด · QR_CODE/TRANSFER = ธนาคาร · อื่น ๆ (บัตร ฯลฯ) และบิลที่ไม่มีแถว payment = other
// COGS ใช้ calculateCOGS ตัวเดียวกับที่ลงบัญชี POS_COGS ตอนปิดบิล (มีสาขาเมนูไม่มีสูตร + กรอง tenant ครบ)
function summariseZBills(tenantId: string, bills: ZBill[]) {
  const paymentsStmt = db.prepare(`
    SELECT payment_method, SUM(amount) as amount FROM pos_payments
    WHERE bill_id = ? AND tenant_id = ? GROUP BY payment_method
  `)
  const t = { revenue: 0, tax: 0, service: 0, discount: 0, cogs: 0, cash: 0, bank: 0, other: 0 }
  for (const bill of bills) {
    const total = bill.total_amount || 0
    t.revenue += total
    t.tax += bill.tax_amount || 0
    t.service += bill.service_charge_amount || 0
    t.discount += bill.discount_amount || 0
    t.cogs += posAccountingService.calculateCOGS(bill.id, tenantId).totalCost

    const pays = paymentsStmt.all(bill.id, tenantId) as { payment_method: string; amount: number }[]
    const paid = pays.reduce((s, p) => s + (p.amount || 0), 0)
    if (paid <= 0) { t.other += total; continue }
    for (const p of pays) {
      const share = total * (p.amount || 0) / paid
      if (p.payment_method === 'CASH') t.cash += share
      else if (BANK_METHODS.has(p.payment_method)) t.bank += share
      else t.other += share
    }
  }
  const revenue = r2(t.revenue)
  const cash = r2(t.cash)
  const bank = r2(t.bank)
  const cogs = r2(t.cogs)
  return {
    total_revenue: revenue,
    total_tax: r2(t.tax),
    total_service_charge: r2(t.service),
    total_discount: r2(t.discount),
    estimated_cogs: cogs,
    // ช่องนี้ชื่อ net_profit แต่ไม่มีค่าใช้จ่ายอื่นให้หักในระดับวัน = กำไรขั้นต้น
    // ยอดบิลรวม VAT ที่ต้องส่งสรรพากร ต้องหัก VAT ออกก่อน ไม่งั้นกำไรเกินจริงเท่ายอดภาษี
    net_profit: r2(revenue - t.tax - cogs),
    cash_amount: cash,
    bank_amount: bank,
    other_amount: r2(revenue - cash - bank), // ปัดเศษแล้วยังรวมได้เท่ายอดพอดี
    bill_count: bills.length,
  }
}

// GET all POS daily sales summaries
// bill_count นับเฉพาะบิลที่ยัง PAID · voided_bill_count = บิลที่ถูก void/cancel หลังสรุป (ยอดสดดูที่ GET :id)
router.get('/pos-daily-sales', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { date_from, date_to, limit = 50 } = req.query

    let query = `
      SELECT
        ds.*,
        u.name as closed_by_name,
        COUNT(CASE WHEN b.status = 'PAID' THEN 1 END) as bill_count,
        COUNT(CASE WHEN b.status != 'PAID' THEN 1 END) as voided_bill_count
      FROM pos_daily_sales ds
      LEFT JOIN users u ON ds.closed_by = u.id AND u.tenant_id = ds.tenant_id
      LEFT JOIN pos_daily_sales_bills dsb ON ds.id = dsb.daily_sales_id AND dsb.tenant_id = ds.tenant_id
      LEFT JOIN pos_running_bills b ON b.id = dsb.bill_id AND b.tenant_id = ds.tenant_id
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
    params.push(Math.min(Math.max(parseInt(limit as string) || 50, 1), 500))

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

    // บิลจ่ายหลายช่องทางเคยออกมาซ้ำหลายแถว (JOIN pos_payments) — รวมเป็นแถวเดียว
    const bills = (db.prepare(`
      SELECT
        b.id,
        b.bill_number,
        b.display_name,
        b.total_amount,
        b.closed_at,
        (SELECT GROUP_CONCAT(DISTINCT p.payment_method) FROM pos_payments p
          WHERE p.bill_id = b.id AND p.tenant_id = b.tenant_id) as payment_method
      FROM pos_running_bills b
      WHERE b.tenant_id = ?
        AND b.status = 'PAID'
        AND b.id NOT IN (
          SELECT bill_id FROM pos_daily_sales_bills WHERE tenant_id = ?
        )
      ORDER BY b.closed_at DESC
      LIMIT 100
    `).all(tenantId, tenantId) as any[])

    res.json({ success: true, data: bills })
  } catch (error) {
    console.error('Get pending bills error:', error)
    res.status(500).json({ success: false, message: 'Failed to fetch pending bills' })
  }
})

// GET single POS daily sales summary with details
// บิลที่ถูก void/cancel หลังสรุปแล้วไม่นับ: ถ้ามี ยอดทั้งหมดคำนวณใหม่จากบิลที่ยัง PAID
// (excluded_bills บอกว่าบิลไหนหลุดไป) · ถ้าไม่มี คืนค่าที่บันทึกไว้ตอนปิดวันตามเดิม
router.get('/pos-daily-sales/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const { id } = req.params

    // Get summary
    const summary = db.prepare(`
      SELECT ds.*, u.name as closed_by_name
      FROM pos_daily_sales ds
      LEFT JOIN users u ON ds.closed_by = u.id AND u.tenant_id = ds.tenant_id
      WHERE ds.id = ? AND ds.tenant_id = ?
    `).get(id, tenantId) as any

    if (!summary) {
      return res.status(404).json({ success: false, message: 'Daily sales summary not found' })
    }

    const linked = db.prepare(`
      SELECT b.id, b.bill_number, b.status, b.total_amount, b.tax_amount,
             b.service_charge_amount, b.discount_amount
      FROM pos_daily_sales_bills dsb
      JOIN pos_running_bills b ON dsb.bill_id = b.id AND b.tenant_id = dsb.tenant_id
      WHERE dsb.daily_sales_id = ? AND dsb.tenant_id = ?
    `).all(id, tenantId) as any[]
    const excluded = linked.filter(b => b.status !== 'PAID')
    const totals = excluded.length > 0
      ? summariseZBills(tenantId, linked.filter(b => b.status === 'PAID'))
      : {}

    // Get linked bills (one row per bill; split payments joined into one string)
    const bills = db.prepare(`
      SELECT
        b.bill_number,
        b.display_name,
        b.total_amount,
        b.closed_at,
        (SELECT GROUP_CONCAT(DISTINCT p.payment_method) FROM pos_payments p
          WHERE p.bill_id = b.id AND p.tenant_id = b.tenant_id) as payment_method
      FROM pos_daily_sales_bills dsb
      JOIN pos_running_bills b ON dsb.bill_id = b.id AND b.tenant_id = dsb.tenant_id
      WHERE dsb.daily_sales_id = ? AND dsb.tenant_id = ? AND b.status = 'PAID'
      ORDER BY b.closed_at ASC
    `).all(id, tenantId)

    // Get sales by product
    const products = db.prepare(`
      SELECT
        bi.product_name,
        SUM(bi.quantity) as total_qty,
        SUM(bi.total_price) as total_amount,
        p.category as product_category
      FROM pos_daily_sales_bills dsb
      JOIN pos_running_bills b ON dsb.bill_id = b.id AND b.tenant_id = dsb.tenant_id
      JOIN pos_bill_items bi ON b.id = bi.bill_id AND bi.tenant_id = dsb.tenant_id
      LEFT JOIN pos_menu_configs pmc ON bi.pos_menu_id = pmc.id AND pmc.tenant_id = dsb.tenant_id
      -- เมนู POS ผูกกับ stock_items (pmc.product_id = stock_items.id) ไม่ใช่ products ที่เลิกใช้แล้ว
      LEFT JOIN stock_items p ON pmc.product_id = p.id AND p.tenant_id = pmc.tenant_id
      WHERE dsb.daily_sales_id = ? AND dsb.tenant_id = ? AND b.status = 'PAID'
      GROUP BY bi.product_name
      ORDER BY total_amount DESC
    `).all(id, tenantId)

    // Get payment breakdown
    const payments = db.prepare(`
      SELECT
        p.payment_method,
        COUNT(*) as count,
        SUM(p.amount) as total_amount
      FROM pos_daily_sales_bills dsb
      JOIN pos_running_bills b ON dsb.bill_id = b.id AND b.tenant_id = dsb.tenant_id
      JOIN pos_payments p ON b.id = p.bill_id AND p.tenant_id = dsb.tenant_id
      WHERE dsb.daily_sales_id = ? AND dsb.tenant_id = ? AND b.status = 'PAID'
      GROUP BY p.payment_method
    `).all(id, tenantId)

    res.json({
      success: true,
      data: {
        ...summary,
        ...totals,
        excluded_bills: excluded.map(b => ({ id: b.id, bill_number: b.bill_number, status: b.status })),
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

class ZReportError extends Error {}

// POST create daily sales summary (Close Day)
// เอาเฉพาะบิล PAID ที่ยังไม่เคยสรุป และปิดบิล (closed_at) ในวันที่ sales_date ตามปฏิทินไทย
// เดิมกวาดบิลค้างทุกวันมารวมในวันเดียว — บิลวันก่อนที่ยังไม่ปิดวัน ให้ส่ง sales_date ของวันนั้นมาปิดแยก
router.post('/pos-daily-sales', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const userId = req.user!.userId
    const { sales_date, notes } = req.body

    if (sales_date !== undefined && sales_date !== null && sales_date !== ''
        && !(typeof sales_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sales_date))) {
      return res.status(400).json({ success: false, message: 'sales_date ต้องเป็นรูปแบบ YYYY-MM-DD' })
    }
    const targetDate: string = sales_date || thaiDateStr()

    const result = db.transaction(() => {
      const existingCheck = db.prepare(`
        SELECT id FROM pos_daily_sales WHERE tenant_id = ? AND sales_date = ?
      `).get(tenantId, targetDate)
      if (existingCheck) {
        throw new ZReportError('This date has already been closed. Please use a different date.')
      }

      // กรองหยาบใน SQL (±1 วัน UTC) แล้วกรองจริงด้วยวันที่ไทยของ closed_at
      const bills = (db.prepare(`
        SELECT b.id, b.closed_at, b.total_amount, b.tax_amount, b.service_charge_amount, b.discount_amount
        FROM pos_running_bills b
        WHERE b.tenant_id = ?
          AND b.status = 'PAID'
          AND b.closed_at >= date(?, '-1 day') AND b.closed_at < date(?, '+2 day')
          AND b.id NOT IN (SELECT bill_id FROM pos_daily_sales_bills WHERE tenant_id = ?)
      `).all(tenantId, targetDate, targetDate, tenantId) as (ZBill & { closed_at: string })[])
        .filter(b => thaiDateStr(b.closed_at) === targetDate)

      if (bills.length === 0) {
        throw new ZReportError('ไม่มีบิลที่ชำระแล้วที่รอปิดกะ')
      }

      const totals = summariseZBills(tenantId, bills)
      const summaryNumber = formatDocumentNumber('POS-SUM', tenantId, 'POS_DAILY_SALES', targetDate.replace(/-/g, ''), 3)
      const summaryId = generateId()

      db.prepare(`
        INSERT INTO pos_daily_sales (
          id, tenant_id, summary_number, sales_date,
          total_revenue, total_tax, total_service_charge, total_discount,
          estimated_cogs, net_profit,
          cash_amount, bank_amount, other_amount,
          bill_count, notes, closed_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        summaryId, tenantId, summaryNumber, targetDate,
        totals.total_revenue, totals.total_tax, totals.total_service_charge, totals.total_discount,
        totals.estimated_cogs, totals.net_profit,
        totals.cash_amount, totals.bank_amount, totals.other_amount,
        totals.bill_count, notes || null, userId, new Date().toISOString()
      )

      const linkStmt = db.prepare(`
        INSERT INTO pos_daily_sales_bills (id, tenant_id, daily_sales_id, bill_id, amount)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const bill of bills) {
        linkStmt.run(generateId(), tenantId, summaryId, bill.id, bill.total_amount)
      }

      return { id: summaryId, summary_number: summaryNumber, sales_date: targetDate, ...totals }
    })()

    res.json({ success: true, message: 'Daily sales summary created successfully', data: result })
  } catch (error: any) {
    if (error instanceof ZReportError) {
      return res.status(400).json({ success: false, message: error.message })
    }
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ success: false, message: 'This date or one of its bills was closed concurrently. Please refresh.' })
    }
    console.error('Create POS daily sales error:', error)
    res.status(500).json({ success: false, message: 'Failed to create daily sales summary' })
  }
})

// ============================================
// POS SHIFTS (เปิด/ปิดกะ)
// ============================================

class ShiftAlreadyClosedError extends Error {}

/** เงินสดต้องเป็นตัวเลข finite ≥ 0 — ปัด 2 ตำแหน่ง · ไม่ผ่าน = null */
function parseCashAmount(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

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

    if (!shift) {
      const lastClosed = db.prepare(`
        SELECT id, shift_number, closed_at, closing_cash_counted
        FROM pos_shifts
        WHERE tenant_id = ? AND status = 'CLOSED'
        ORDER BY closed_at DESC, opened_at DESC
        LIMIT 1
      `).get(tenantId) as any
      const suggestedOpeningCash = lastClosed && lastClosed.closing_cash_counted !== null && lastClosed.closing_cash_counted !== undefined
        ? Number(lastClosed.closing_cash_counted) || 0
        : 0
      return res.json({
        success: true,
        data: null,
        last_closed_shift: lastClosed || null,
        suggested_opening_cash: suggestedOpeningCash,
      })
    }

    // Attach current sales summary from bills since shift opened
    const sales = getShiftSalesSummary(tenantId, shift)
    const movements = getShiftCashMovementTotals(tenantId, shift.id)

    // stale = กะเปิดค้างจากวันก่อน (เวลาไทย) — เปิดบิลใหม่ไม่ได้ ต้องเคลียร์บิลค้างแล้วปิดกะนี้
    const stale = thaiDateStr(shift.opened_at) < thaiDateStr()
    res.json({ success: true, data: {
      ...shift, stale, // opened_by + opened_by_name มากับ s.* และ JOIN users แล้ว
      live: { ...sales, cash_in: movements.cashIn, paid_out: movements.paidOut },
    } })
  } catch (error) {
    console.error('Get current shift error:', error)
    res.status(500).json({ success: false, message: 'Failed to get current shift' })
  }
})

// GET last closed shift (for opening cash suggestions)
router.get('/pos-shifts/last-closed', (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId
    const lastClosed = db.prepare(`
      SELECT id, shift_number, closed_at, closing_cash_counted
      FROM pos_shifts
      WHERE tenant_id = ? AND status = 'CLOSED'
      ORDER BY closed_at DESC, opened_at DESC
      LIMIT 1
    `).get(tenantId) as any
    const suggestedOpeningCash = lastClosed && lastClosed.closing_cash_counted !== null && lastClosed.closing_cash_counted !== undefined
      ? Number(lastClosed.closing_cash_counted) || 0
      : 0
    res.json({
      success: true,
      data: lastClosed || null,
      suggested_opening_cash: suggestedOpeningCash,
    })
  } catch (error) {
    console.error('Get last closed shift error:', error)
    res.status(500).json({ success: false, message: 'Failed to get last closed shift' })
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
    const { notes } = req.body
    const openingGapReason = typeof req.body.opening_gap_reason === 'string' ? req.body.opening_gap_reason.trim() : ''
    const opening_cash = parseCashAmount(req.body.opening_cash)
    if (opening_cash === null) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุเงินสดเปิดกะเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' })
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

    // เงินเปิดกะน้อยกว่าที่นับได้ตอนปิดกะก่อน = มีเงินออกจากลิ้นชักระหว่างกะ (เช่นพนักงานเอาไปซื้อของ)
    // ถ้าระบุหมายเหตุมา ให้ลงเป็นรายการ OPENING_GAP เข้าบัญชีพัก 1182 รอจับคู่กับบิลในหน้าจ่ายเงินผู้ขาย
    // ไม่นับใน expected_cash ของกะนี้ เพราะเงินออกไปก่อนนับยอดเปิดกะแล้ว
    const lastClosed = db.prepare(`
      SELECT closing_cash_counted FROM pos_shifts
      WHERE tenant_id = ? AND status = 'CLOSED' ORDER BY closed_at DESC, opened_at DESC LIMIT 1
    `).get(tenantId) as { closing_cash_counted: number | null } | undefined
    const openingGap = lastClosed?.closing_cash_counted != null
      ? Math.round((lastClosed.closing_cash_counted - opening_cash) * 100) / 100
      : 0

    let gapMovementId: string | null = null
    db.transaction(() => {
      db.prepare(`
        INSERT INTO pos_shifts (id, tenant_id, shift_number, status, opened_at, opening_cash, opened_by, notes, created_at)
        VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)
      `).run(id, tenantId, shiftNumber, nowStr, opening_cash, userId, notes || null, nowStr)

      if (openingGap > 0 && openingGapReason) {
        gapMovementId = recordPosPayoutPending(tenantId, userId, { id, shift_number: shiftNumber }, 'OPENING_GAP', openingGap, openingGapReason, nowStr)
      }
    })()

    res.json({ success: true, message: 'เปิดกะสำเร็จ', data: { id, shift_number: shiftNumber, opened_at: nowStr, opening_gap: openingGap, opening_gap_movement_id: gapMovementId } })
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
    const { notes } = req.body
    const closing_cash_counted = parseCashAmount(req.body.closing_cash_counted)
    if (closing_cash_counted === null) {
      return res.status(400).json({ success: false, message: 'กรุณานับและกรอกเงินสดในลิ้นชักเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' })
    }

    const shift = db.prepare(`SELECT * FROM pos_shifts WHERE id = ? AND tenant_id = ? AND status = 'OPEN'`).get(id, tenantId) as any
    if (!shift) return res.status(404).json({ success: false, message: 'ไม่พบกะที่เปิดอยู่' })

    // ปิดกะไม่ได้ถ้ายังมีบิลค้าง (ทั้ง tenant รวมบิลที่ไม่มี shift_id) — ต้องชำระหรือยกเลิกก่อน
    // ไม่งั้นยอดกะไม่ครบ และบิลค้างจะไปถูกนับในกะถัดไป
    const openBills = db.prepare(`SELECT id, bill_number FROM pos_running_bills WHERE tenant_id = ? AND status = 'OPEN' ORDER BY opened_at`).all(tenantId) as { id: string; bill_number: string }[]
    if (openBills.length > 0) {
      return res.status(409).json({
        success: false, code: 'SHIFT_HAS_OPEN_BILLS',
        message: `ยังมีบิลค้างชำระ ${openBills.length} บิล กรุณาชำระหรือยกเลิกก่อนปิดกะ`,
        count: openBills.length, open_bills: openBills,
      })
    }

    // รายการนำเงินไปใช้จ่ายก่อนปิดเก๊ะ (petty cash expenses / cash out)
    const rawExpenses = Array.isArray(req.body.cash_expenses) ? req.body.cash_expenses : []
    const validExpenses: Array<{ reason: string; amount: number; account_id?: string }> = []
    for (const exp of rawExpenses) {
      const amt = Number(exp.amount)
      const reason = typeof exp.reason === 'string' ? exp.reason.trim() : ''
      if (amt > 0 && reason) {
        validExpenses.push({ reason, amount: amt, account_id: exp.account_id })
      }
    }

    // ปัดเป็นสตางค์ก่อนใช้ทุกตัว — ยอดบิลบางใบมีเศษเกิน 2 ตำแหน่ง/เศษ floating point
    // ถ้าปล่อยให้ postJournal ปัดทีละบรรทัดเอง ผลรวมสองฝั่งจะหลุดกัน 0.01 แล้วปิดกะไม่ได้
    const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
    const nowStr = new Date().toISOString()
    const today = thaiDateStr() // วันที่ลงบัญชีตามเวลาไทย (nowStr เป็น UTC → 00:00–06:59 ได้วันก่อน)

    let journalEntryId: string | null = null
    let sales: any
    let movements: { cashIn: number; paidOut: number } = { cashIn: 0, paidOut: 0 }
    let expectedCash = 0
    let cashDifference = 0

    // ปิดสถานะกะกับลงบัญชีต้องสำเร็จหรือล้มไปด้วยกัน — เดิมลงบัญชีพังแล้วกะถูกปิดค้าง
    // (CLOSED แต่ไม่มี journal บัญชีพักไม่ถูกเคลียร์ และกดปิดซ้ำไม่ได้เพราะเจอ 404)
    db.transaction(() => {
      // 1. บันทึกรายการเงินจ่ายออกจากเก๊ะที่ระบุมาก่อนปิดเก๊ะ
      if (validExpenses.length > 0) {
        const defaultExpenseAccountId = getOrCreateAccount(tenantId, ACC.OTHER_EXPENSE)
        const cashAccountId = getOrCreateAccount(tenantId, ACC.CASH)
        for (const exp of validExpenses) {
          const movementId = generateId()
          let accId = defaultExpenseAccountId
          if (exp.account_id) {
            const accCheck = db.prepare('SELECT id FROM chart_of_accounts WHERE id = ? AND tenant_id = ?').get(exp.account_id, tenantId)
            if (accCheck) accId = exp.account_id
          }

          db.prepare(`
            INSERT INTO pos_shift_cash_movements (id, tenant_id, shift_id, type, amount, reason, account_id, created_by, created_at)
            VALUES (?, ?, ?, 'PAID_OUT', ?, ?, ?, ?, ?)
          `).run(movementId, tenantId, id, exp.amount, exp.reason, accId, userId, nowStr)

          console.log(`[SHIFT EXPENSE AUDIT] Shift: ${shift.shift_number}, User: ${userId}, Amount: ${exp.amount}, Reason: ${exp.reason}`)

          const desc = `จ่ายออกจากลิ้นชัก กะ ${shift.shift_number} - ${exp.reason}`
          postSimpleJournal(tenantId, userId, today, 'POS_CASH_MOVEMENT', movementId, desc, accId, cashAccountId, exp.amount)
        }
      }

      // 2. คำนวณยอดขายและยอดเงินเข้า-ออกของกะนี้ (รวมรายการจ่ายออกด้านบนแล้ว)
      sales = getShiftSalesSummary(tenantId, shift)
      movements = getShiftCashMovementTotals(tenantId, id)

      // บิลที่ไม่มี payment (หรือ payment ไม่ครบ) ไม่เข้าทั้งเงินสดและธนาคาร แต่ขาเงินสดตอนปิดกะเป็น "ส่วนที่เหลือ"
      // จึงดูดยอดนี้เข้าเงินสดเงียบ ๆ — เตือนไว้ให้ตามดูบิลนั้น
      const unclassified = (sales.total_revenue || 0) - (sales.cash_revenue || 0) - (sales.bank_revenue || 0)
      if (unclassified > 0.01) {
        console.warn(`⚠️ ปิดกะ ${shift.shift_number}: ยอดบิล ${unclassified.toFixed(2)} บาทไม่มีรายการรับชำระ (pos_payments) — ถูกนับเป็นเงินสด`)
      }

      expectedCash = r2((shift.opening_cash || 0) + (sales.cash_revenue || 0) + movements.cashIn - movements.paidOut)
      cashDifference = r2(closing_cash_counted - expectedCash)

      // รวบรวม notes: ถ้ามีรายการค่าใช้จ่าย ให้บันทึกลง notes ของกะด้วยเพื่อใช้อ้างอิงในรายงาน
      let finalNotes = notes || null
      if (validExpenses.length > 0) {
        const expenseSummary = validExpenses.map(e => `${e.reason} ${e.amount.toLocaleString()} บ.`).join(', ')
        finalNotes = notes
          ? `${notes} [ค่าใช้จ่ายก่อนปิดเก๊ะ: ${expenseSummary}]`
          : `[ค่าใช้จ่ายก่อนปิดเก๊ะ: ${expenseSummary}]`
      }

      if (cashDifference < 0) {
        const shortageNote = `[รอ Admin อนุมัติตรวจสอบเงินขาด ฿${Math.abs(cashDifference)}]`
        finalNotes = finalNotes ? `${finalNotes} ${shortageNote}` : shortageNote
        console.warn(`[SHIFT SHORTAGE AUDIT] Shift ${shift.shift_number} shortage: ฿${Math.abs(cashDifference)} (User: ${userId})`)
      }

      const closed = db.prepare(`
        UPDATE pos_shifts SET
          status = 'CLOSED', closed_at = ?,
          closing_cash_counted = ?, expected_cash = ?, cash_difference = ?,
          total_revenue = ?, cash_revenue = ?, bank_revenue = ?,
          bill_count = ?, closed_by = ?,
          notes = COALESCE(?, notes)
        WHERE id = ? AND tenant_id = ? AND status = 'OPEN'
      `).run(
        nowStr, closing_cash_counted, expectedCash, cashDifference,
        sales.total_revenue, sales.cash_revenue, sales.bank_revenue,
        sales.bill_count, userId, finalNotes, id, tenantId
      )
      if (closed.changes !== 1) throw new ShiftAlreadyClosedError()

      // Post เงินขาด/เงินเกิน เข้าบัญชีทันทีที่ปิดกะ (ข้ามถ้าเท่ากันพอดี) — ป้องกันลงซ้ำ
      // อัตโนมัติเพราะ UPDATE ด้านบนใช้ WHERE status='OPEN' เท่านั้น กดปิดซ้ำจะเจอ 404
      // ก่อนถึงจุดนี้เสมอ (shift ถูกเปลี่ยนเป็น CLOSED ไปแล้วในรอบแรก)
      //
      // ปิดกะ = ปิดยอดบัญชีพัก 1180 ทั้งก้อน ไม่ใช่ลงแค่ส่วนต่าง
      //   Dr เงินสด        ยอดขายเงินสด บวก/ลบ ส่วนต่างที่นับได้จริง
      //   Dr ธนาคาร        ยอดขายที่รับผ่านโอน/QR (เข้าบัญชีไปแล้วตั้งแต่ลูกค้าจ่าย)
      //   Dr 5901          ถ้านับเงินได้น้อยกว่าที่ควรมี
      //   Cr 1180          ยอดบิลทั้งกะ — หลังบรรทัดนี้บัญชีพักต้องกลับเป็นศูนย์
      //   Cr 5901          ถ้านับเงินได้มากกว่าที่ควรมี
      //
      // เดิมลงเฉพาะส่วนต่างเงินขาด/เงินเกิน เพราะสมมติว่ายอดขายเข้าเงินสดไปแล้วตั้งแต่ปิดบิล
      // พอย้ายฝั่งขายไปลงบัญชีพักแทน (pos-accounting.service.ts) ขั้นนี้ต้องรับช่วงปิดยอดเอง
      //
      // เงินทอนเริ่มกะกับเงินเข้า-ออกลิ้นชักไม่เกี่ยวกับยอดขาย มี journal ของตัวเองอยู่แล้ว
      // จึงไม่นับซ้ำในรายการนี้ — ใช้แค่ cash_revenue / bank_revenue ของกะนี้
      // ปัดที่ยอดรวม (ไม่ใช่รายบรรทัด) แล้วให้ขาเงินสดเป็น "ส่วนที่เหลือ" ของยอดบิล
      // = ยอดบิล − ธนาคาร + ส่วนต่าง → เดบิตเท่าเครดิตเป๊ะเสมอ ไม่ว่าเศษจะปัดไปทางไหน
      // ติดลบได้ถ้าเงินขาดมากกว่ายอดขายเงินสด (เช่นกะที่ขายโอนล้วนแต่เงินทอนหาย) → ย้ายไปฝั่งเครดิต
      const journal = buildShiftCloseJournal({
        tenant_id: tenantId, id, opened_at: shift.opened_at,
        shift_number: shift.shift_number, total_revenue: sales.total_revenue,
        bank_revenue: sales.bank_revenue, cash_difference: cashDifference,
      })
      if (journal) {
        journalEntryId = postJournal({
          tenantId,
          date: today,
          referenceType: 'POS_SHIFT_CLOSE',
          referenceId: id,
          description: journal.description,
          createdBy: userId,
          businessUnit: 'RETAIL',
          sourceNumber: shift.shift_number,
          lines: journal.lines,
        })
      }
    })()

    // ปิดกะลงบันทึกความเคลื่อนไหวเสมอ — เงินขาดแดง เงินเกินส้ม (เงินเข้ามือโดยไม่มีที่มา) ตรงเป๊ะเขียว
    recordAutoAction({
      tenantId, user: req.user as any, category: 'pos_shift_close', refType: 'pos_shifts', refId: id,
      amount: Math.abs(cashDifference),
      description: `ปิดกะ ${shift.shift_number} ควรมี ฿${expectedCash.toLocaleString()} นับได้ ฿${closing_cash_counted.toLocaleString()}`
        + (cashDifference < 0 ? ` เงินขาด ฿${Math.abs(cashDifference).toLocaleString()}` : cashDifference > 0 ? ` เงินเกิน ฿${cashDifference.toLocaleString()}` : ' ตรงพอดี')
        + (validExpenses.length ? ` · ใช้เงินก่อนปิด ${validExpenses.map(e => `${e.reason} ฿${e.amount.toLocaleString()}`).join(', ')}` : ''),
      payload: { severity: cashDifference < 0 ? 'high' : cashDifference > 0 ? 'medium' : 'info', difference: cashDifference },
    })

    try {
      const { lineBotService } = require('../../services/line-bot.service')
      lineBotService.notifyShiftClosed(tenantId, buildShiftSummary(tenantId, id))
        .catch((err: any) => console.error('[ปิดกะ] ส่งสรุปเข้า LINE ไม่สำเร็จ:', err))
    } catch (err) {
      console.error('[ปิดกะ] สร้างสรุปส่ง LINE ไม่สำเร็จ (ปิดกะสำเร็จแล้ว):', err)
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
    // ลงบัญชีไม่ผ่าน = กะยังเปิดอยู่ (rollback แล้ว) บอกเหตุผลจริงให้ผู้ใช้เห็น
    if (error instanceof JournalError) return res.status(400).json({ success: false, message: error.message })
    if (error instanceof ShiftAlreadyClosedError) return res.status(409).json({ success: false, message: 'กะนี้ถูกปิดไปแล้ว' })
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

    if (type !== 'PAID_OUT' && type !== 'CASH_IN' && type !== 'OPENING_GAP') {
      return res.status(400).json({ success: false, message: 'ประเภทไม่ถูกต้อง (ต้องเป็น PAID_OUT, CASH_IN หรือ OPENING_GAP)' })
    }
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุจำนวนเงินให้ถูกต้อง' })
    }
    if (!account_id) {
      return res.status(400).json({ success: false, message: 'กรุณาเลือกบัญชี' })
    }
    if (!String(reason ?? '').trim()) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุเหตุผลที่นำเงินเข้า/ออกลิ้นชัก' })
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
    const today = thaiDateStr() // วันที่ลงบัญชีตามเวลาไทย (nowStr เป็น UTC → 00:00–06:59 ได้วันก่อน)
    const desc = `${type === 'CASH_IN' ? 'รับเข้าลิ้นชัก' : type === 'OPENING_GAP' ? 'เงินออกจากลิ้นชักก่อนเปิด' : 'จ่ายออกจากลิ้นชัก'} กะ ${shift.shift_number}${reason ? ' - ' + reason : ''}`
    const journalEntryId = type !== 'CASH_IN'
      // จ่ายออก: Dr บัญชีค่าใช้จ่ายที่เลือก / Cr เงินสด
      ? postSimpleJournal(tenantId, userId, today, 'POS_CASH_MOVEMENT', movementId, desc, account_id, cashAccountId, amt)
      // รับเข้า: Dr เงินสด / Cr บัญชีที่เลือก
      : postSimpleJournal(tenantId, userId, today, 'POS_CASH_MOVEMENT', movementId, desc, cashAccountId, account_id, amt)

    recordAutoAction({
      tenantId, user: req.user as any, category: 'pos_cash_move', refType: 'pos_shift_cash_movements', refId: movementId,
      amount: amt, description: desc,
      payload: { severity: type === 'PAID_OUT' ? 'medium' : 'info', shiftId: id, type },
    })

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

    // ประตูอนุมัติ: หมวด "ปิดบิล POS / คืนเงิน"
    const gateArgs = {
      tenantId,
      user: req.user as any,
      category: 'pos_void' as const,
      refType: 'pos_running_bills',
      refId: id,
      amount: bill.total_amount || 0,
      description: `บิลที่ชำระแล้ว ${bill.bill_number} ยอด ฿${(bill.total_amount || 0).toLocaleString()} ขอยกเลิก${reason ? ` เนื่องจาก ${reason}` : ''}`,
      payload: { billId: id, reason, finalStatus: 'VOID', severity: 'high' }, // คืนเงินบิลที่รับเงินแล้ว
    }
    const pending = gateOrCreate(gateArgs)
    if (pending) {
      return res.status(202).json({
        success: true,
        pending_approval: true,
        request_number: pending.request_number,
        message: `ส่งคำขออนุมัติแล้ว (${pending.request_number}) บิลจะถูกยกเลิกเมื่อผู้อนุมัติยืนยัน`,
      })
    }

    // ใช้เส้นทางเดียวกับ POST /pos/bills/:id/cancel — เดิมไฟล์นี้เขียน journal reversal เอง
    // ด้วยผังบัญชีคนละชุด (สลับ debit/credit บน 4101 แทนการเด้งไป 4302) ไม่มี guard กันลงซ้ำ
    // และอัปเดตสถานะบิลก่อนคืนสต็อก ทำให้พังกลางคันแล้ว retry ไม่ได้
    const { stockResult } = await cancelPosBill(tenantId, userId, id, reason, 'VOID')
    recordAutoAction(gateArgs)

    res.json({
      success: true,
      message: `ยกเลิกบิล ${bill.bill_number} สำเร็จ`,
      data: {
        bill_id: id,
        bill_number: bill.bill_number,
        amount: bill.total_amount,
        void_note: reason ? `[VOID] ${reason}` : '[VOID]',
        stock_returns: stockResult.returns.length,
      },
    })
  } catch (error) {
    console.error('Void bill error:', error)
    res.status(500).json({ success: false, message: 'ยกเลิกบิลไม่สำเร็จ' })
  }
})

export default router
